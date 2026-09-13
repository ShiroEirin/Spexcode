import { useCallback, useMemo, useRef, useState } from 'react'

// ONE HOST CONTRACT, MANY HOMES ([[widgets]]). A widget only ever calls `spex.draft/save`; the home it is drawn
// in decides where that draft waits, what the send posts, and whose state the send commits. The conversation
// and an issue thread are both homes, and both hold their pending drafts here, so a draft block, a discard and
// a send mean the same thing wherever a widget lands. A draft is keyed by its OWNER session and its name,
// because a thread draws widgets of several sessions at once and two of them may share a name.

const EMPTY = []

const same = (session, name) => (entry) => entry.session === session && entry.name === name

// what the widget would contribute to the next send; an empty text withdraws it. An update keeps the block's
// place in the queue, a new one joins the end.
export function putWidgetDraft(drafts, session, name, text, state) {
  const match = same(session, name)
  if (!text || !text.trim()) return drafts.some(match) ? drafts.filter((entry) => !match(entry)) : drafts
  const entry = { session, name, text, state }
  return drafts.some(match) ? drafts.map((held) => (match(held) ? entry : held)) : [...drafts, entry]
}

export const dropWidgetDraft = (drafts, session, name) => drafts.filter((entry) => !same(session, name)(entry))

// the per-name view one owner's frames read: `name → { text, state }`
export const draftsOfSession = (drafts, session) => Object.fromEntries(
  drafts.filter((entry) => entry.session === session).map((entry) => [entry.name, { text: entry.text, state: entry.state }]),
)

export const bumpWidgetReload = (reloads, session, name) => ({
  ...reloads,
  [session]: { ...reloads[session], [name]: ((reloads[session] || {})[name] || 0) + 1 },
})

// the one message a send carries: every pending block's text, then what the human typed
export const composeWidgetMessage = (drafts, text) => [...drafts.map((entry) => entry.text), text]
  .filter((part) => part && part.trim()).join('\n\n')

// the state half of the send, addressed to the session that owns each widget
export const widgetCommits = (drafts) => drafts.map(({ session, name, state }) => ({ session, name, state }))

export const widgetOwners = (drafts) => [...new Set(drafts.map((entry) => entry.session))]

// The home owns the send; `sendRef` is where it leaves the function a frame's own send button presses, so the
// frame drives the SAME send as the composer rather than a private channel.
//
// @@@handlers-outlive-renders - a frame's document takes its bridge object once, when it loads, and keeps
// calling the draft handler it found then. So each owner's handlers are created once and only ever reach
// state through setters and refs: a stale bridge still writes into the live queue.
export function useWidgetHost() {
  const [drafts, setDrafts] = useState(EMPTY)
  const [reloads, setReloads] = useState({})
  const sendRef = useRef(null)
  const handlers = useRef(new Map())
  const handlersFor = useCallback((session) => {
    let held = handlers.current.get(session)
    if (!held) {
      held = {
        onDraft: (name, text, state) => setDrafts((prev) => putWidgetDraft(prev, session, name, text, state)),
        // discarding says this message will not carry that widget, and reloads its frame back to body plus
        // committed state: only the widget can draw its own interface
        onRemoveDraft: (name) => {
          setDrafts((prev) => dropWidgetDraft(prev, session, name))
          setReloads((prev) => bumpWidgetReload(prev, session, name))
        },
        onSend: () => sendRef.current?.(),
      }
      handlers.current.set(session, held)
    }
    return held
  }, [])
  // one scope object per owner for as long as its widgets, the drafts and the reloads hold still, so a frame's
  // bridge is not re-registered on every render of the surface around it
  const scopes = useMemo(() => ({ drafts, reloads, byOwner: new Map() }), [drafts, reloads])
  const scopeFor = useCallback((sessionId, widgets = EMPTY) => {
    const held = scopes.byOwner.get(sessionId)
    if (held && held.widgets === widgets) return held
    const scope = {
      sessionId, widgets,
      drafts: draftsOfSession(scopes.drafts, sessionId),
      reloads: scopes.reloads[sessionId] || {},
      ...handlersFor(sessionId),
    }
    scopes.byOwner.set(sessionId, scope)
    return scope
  }, [scopes, handlersFor])
  const discard = useCallback((session, name) => handlersFor(session).onRemoveDraft(name), [handlersFor])
  // a successful send empties the queue and reloads nothing: the interface stays where the human left it
  const clear = useCallback(() => setDrafts(EMPTY), [])
  return { drafts, scopeFor, discard, clear, sendRef }
}

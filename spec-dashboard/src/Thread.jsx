import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Prose from './Prose.js'
import { BlobMedia } from './Evidence.jsx'
import { useMentionAutocomplete, TriggerButton, typeTrigger } from './mentions.jsx'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { STATUS_COLOR, STATUS_GLYPH, liveSession, mentionedSessions, sessionHeadline } from './session.js'
import { mergeThread } from './issueLedger.js'
import { ReviewState, SideValue } from './ReviewShell.jsx'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import { useLaunchers } from './launch.js'
import { routeHash } from './route.js'
import { newTabAnchor } from './tabs.js'
import { WidgetDraftQueue, WidgetRef } from './SessionWidget.jsx'
import { SessionWidgetsContext } from './widgetRefs.js'
import { SessionFilesContext } from './fileRefs.js'
import { FileRef } from './Transcript.jsx'
import { composeWidgetMessage, widgetCommits, widgetOwners } from './widgetHost.js'
import { useIsMobile } from './useIsMobile.js'

// The ONE thread UI ([[issues-view]]): the reply list + the reply composer, shared by every home an
// Issue thread renders in — the issue detail (BOTH stores: a forge issue's GitHub comments are the same
// replies[] and the issue detail. The composer is delivery-agnostic: the home
// passes `onSend(text, evidence)` (reply to an existing thread — the server routes it by the issue's store,
// local-store commit or real forge comment — or lazily create one), so the thread's binding stays the caller's
// concern while the writing surface stays one component — an @-reference stays in the authored prose,
// because every send lands on the same store-routed write path.
//
// A reply's marks live IN its prose (same philosophy as `Spec:`/`[[node]]`): a body whose first line
// reads `▶m:ss · <step>` carries a time anchor, shown as a static chip (no home supplies a clip to seek);
// any attached blob rides the body as a `![…](/api/evidence/<hash>)` link — the SAME hash the send
// derives as the thread's typed `evidence[]`, so the body is the one raw-readable source. Each linked
// blob renders through the ONE shared evidence renderer ([[event-detail]]'s Evidence.jsx, kind sniffed
// from the served Content-Type): a video PLAYS in the thread, an image shows, a pruned blob is the honest
// sentinel. The reply stays plain `{ by, at, body }`; no schema grows.

// The READ regex accepts the archived `/api/yatsu/blob/…` shape beside the live `/api/evidence/…` one:
// committed thread bodies are immutable archives, and an archive keeps its archive name — extraction
// yields the bare hash, so rendering/fetching always goes through the live route. Writes emit only the new shape.
const BLOB_URL = /\/api\/(?:evidence|yatsu\/blob)\/([0-9a-f]{64})/g
// the blob hashes a body references (its frame links) — the send derives the thread's `evidence[]` from here.
export const bodyEvidence = (body) => [...(body || '').matchAll(BLOB_URL)].map((m) => m[1])

const NO_DRAFTS = []

// The thread's ORIGINATOR liveness ([[mentions]] loop-in) — WHO filed this issue, and whether their session
// is still ALIVE. This is a thin join of the originator id against the live board sessions the page already
// holds — session.js's liveSession. A live originator is
// a direct door to its session-board tab; offline remains a
// static identity chip. Reuses the board's four-hue STATUS_COLOR (the live status paints the dot), never a
// second palette. A missing/unresolvable originator
// renders nothing — exactly the case where the loop-in chain runs dry silently (a forge github login, a
// legacy reading).
export function OriginatorLiveness({ originator, sessions = [], onOpenSession = null }) {
  const t = useT()
  if (!originator) return null
  const s = liveSession(sessions, originator)
  const alive = !!s
  const color = alive ? (STATUS_COLOR[s.status] || STATUS_COLOR.working) : STATUS_COLOR.offline
  const title = t('thread.originatorIssue', { by: originator })
  const dot = <span className="fv-originator-dot" style={{ background: color }} aria-hidden="true" />
  // the chip is an identity SKIN over the one SideValue rail primitive ([[review-chrome]]): the value
  // text shrinks/ellipsizes inside the rail while the tooltip/accessible name keeps the full id.
  return (
    <SideValue text={originator} tip={title} label={title} lead={dot}
      className={`fv-originator ${alive ? 'alive' : 'offline'}${alive && onOpenSession ? ' openable' : ''}`}
      onClick={alive && onOpenSession ? () => onOpenSession(originator) : null} />
  )
}

// The reply list: every reply renders as author · time · prose, whatever store it came from. A time anchor
// in the prose renders as a static chip — its label as written — never hidden. A reply written by a board
// session resolves its `[[widget:<name>]]` and `[[file:<name>]]` against THAT session's widgets and posted files
// ([[widgets]] / [[files]] / [[issue-binding]]), exactly as its own conversation would, so an agent reports on the
// issue with the same picture and the same file it shows there; a name the author never put stays the honest
// unresolved chip. Given the page's `widgetHost`, a widget here is as live as in the conversation: its draft waits
// above this thread's composer and the send answers the session that drew it.
// The fleet's DECLARATIONS ride the same thread ([[issue-binding]]'s ledger, read from each session's timeline,
// written nowhere): a row names the session, the board's status word in its colour, and the note — so
// "waiting for review" is read where the human is already reading, and the agent never types a status.
export function Replies({ replies, sessions = [], ledger = [], widgetHost = null }) {
  const t = useT()
  const isMobile = useIsMobile()
  return mergeThread(replies, ledger).map((r, i) => {
    const author = (sessions || []).find((s) => s.id === r.by)
    // a sub-issue opening ([[issues-view]]'s ledger): the declaration row's shape, its body the child as a real anchor
    // wearing the child's current state mark.
    if (r.kind === 'sub-issue') {
      const href = routeHash('issues', r.id)
      return (
        <div className="fv-reply fv-declaration" key={`c-${r.id}`}>
          <div className="fv-reply-meta">
            <span className="fv-reply-by" data-tip={r.by}>{author ? sessionHeadline(author) : r.by}</span>
            {r.at && <span className="fv-reply-at">{r.at}</span>}
            <span className="fv-declaration-word">{t('thread.openedSubIssue')}</span>
          </div>
          <a className="fv-subissue-link" href={href} onClick={(event) => newTabAnchor(event, href)}>
            <ReviewState kind="issue" state={r.status} size={14} />
            <span>{r.concern || r.id}</span>
          </a>
        </div>
      )
    }
    if (r.kind === 'declaration') {
      const color = STATUS_COLOR[r.status] || STATUS_COLOR.idle
      return (
        <div className="fv-reply fv-declaration" key={`d-${i}`} style={{ '--decl': color }}>
          <div className="fv-reply-meta">
            <span className="fv-reply-by" data-tip={r.by}>{author ? sessionHeadline(author) : r.by}</span>
            {r.at && <span className="fv-reply-at">{r.at}</span>}
            <span className="fv-declaration-word" aria-label={t('thread.declared')}><span aria-hidden="true">{STATUS_GLYPH[r.status] || '·'}</span> {t(`status.${r.status}`)}</span>
          </div>
          {r.note && <div className="fv-declaration-note">{r.note}</div>}
        </div>
      )
    }
    const widgetScope = author && widgetHost
      ? widgetHost.scopeFor(author.id, author.widgets)
      : { sessionId: author?.id || null, widgets: author?.widgets || [] }
    const filesScope = { sessionId: author?.id || null, files: author?.files || [], tabs: !isMobile }
    return (
      <div className="fv-reply" key={i}>
        <div className="fv-reply-meta">
          <span className="fv-reply-by">{r.by}</span>
          {r.at && <span className="fv-reply-at">{r.at}</span>}
        </div>
        {r.body && <div className="fvd-body">
          <Prose className="doc-body"
            renderSpecRef={(id, token, provenance) => {
              const href = routeHash('spec', id)
              return <a className="doc-link" href={href} {...provenance} onClick={(event) => newTabAnchor(event, href)}>{id}</a>
            }}
            renderTimeAnchor={(meta, token, provenance) => <span className="fv-anchor" {...provenance}>{meta.label}</span>}
            renderEvidence={(meta, token, provenance) => <span className="fv-reply-media" data-evidence-hash={meta.hash} {...provenance}><BlobMedia hash={meta.hash} alt={meta.alt || 'evidence'} /></span>}
            renderFileRef={(name, token, provenance) => <SessionFilesContext.Provider value={filesScope}><FileRef name={name} provenance={provenance} /></SessionFilesContext.Provider>}
            renderWidgetRef={(name, token, provenance) => <span {...provenance}><SessionWidgetsContext.Provider value={widgetScope}><WidgetRef name={name} /></SessionWidgetsContext.Provider></span>}>
            {r.body}
          </Prose>
        </div>}
      </div>
    )
  })
}

// the ONE docked composer, shared by every home ([[issues-view]] / [[event-detail]]): a QUIET BORDERED
// container holding a BORDERLESS writing surface over a PERSISTENT compact action row. The writing
// surface is already usable at idle — floored at two lines, never a one-line sliver and never a
// click-to-expand — and auto-grows with the draft ABOVE that floor (the shared fitTextarea, floored by
// CSS min-height, capped by CSS max-height so it never eats the pane). The action row is always visible
// and carries only real acts: any
// host-supplied lifecycle action (Close issue / Promote via `actionsEnd`), and the icon-only Send pinned
// at the right edge; a failed send surfaces its error in the same row, never out of view.
// Posts through the caller's `onSend(text, evidence)` as 'human'. @session is a passive reference; @new
// opens the shared launcher chooser. The textarea carries the SAME `[[node]]`/`@` autocomplete as the
// console ([[mentions]], one shared menu, never a fork); the composer is docked at the detail's bottom,
// so its menu opens UPWARD, as an overlay above the container. The thread's own node leads the `[[` list.
// A blob link typed or pasted into the body is thereafter an ordinary — replyable, @-able — reply's mark,
// its hash indexed as the thread's evidence[].
// Given a `widgetHost`, the widgets drawn in the thread above draft into THIS composer: their blocks sit in its
// preview, a pending block alone makes the draft sendable, and the send posts the blocks' text with the typed
// words as one reply, hands it to every session whose widget contributed, and commits each state to its owner.
export function ReplyComposer({ onSend, specs = [], sessions = [], focusId = null, onDone, actionsEnd = null, widgetHost = null, seed = null, onSeedConsumed = null }) {
  const t = useT()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')       // a failed send (a forge can be unreachable) surfaces, never swallows
  const taRef = useRef(null)
  const { launchers } = useLaunchers()
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, launchers, focusId, up: true })
  const frames = bodyEvidence(body)         // the blob links currently in the body (preview + the send's evidence[])
  const drafts = widgetHost?.drafts || NO_DRAFTS
  const sendable = !!body.trim() || drafts.length > 0
  // the retained sessions the draft names by exact id ([[issue-binding]]): each gets an explicit "Send to @x" door
  // in the action row. The token stays a passive reference ([[mentions]]); the BUTTON is the act, and it hands
  // the reply to that session beside posting it — one press, one durable reply, one ordinary send.
  const mentioned = mentionedSessions(body, sessions)

  // the grammar's discoverability doors ([[mentions]]) — the ONE shared insertion mechanism (`typeTrigger`),
  // so this composer and the Issues compose page open the same menu the same way. No second menu, no
  // dispatch: the button only types what the hand would.
  const insertTrigger = (trigger) => typeTrigger(taRef.current, trigger, setBody, (el) => ac.sync(el))
  // a door elsewhere on the page (the rail's New worker) asks the composer to type a trigger for it — the SAME
  // insertion the `@`/`[[` buttons use, so the menu opens and the human's send stays the act. Consumed once.
  useEffect(() => {
    if (!seed) return
    insertTrigger(seed)
    onSeedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  const send = async (deliverTo = []) => {
    const text = composeWidgetMessage(drafts, body.trim())
    if (!text || busy) return
    setBusy(true)
    try {
      // a widget draft answers the session that drew it, so that session is always one of the deliveries
      const res = await onSend(text, bodyEvidence(text), {
        deliverTo: [...new Set([...deliverTo, ...widgetOwners(drafts)])],
        widgets: widgetCommits(drafts),
      })
      if (res?.ok) { setBody(''); setErr(''); widgetHost?.clear(); await onDone?.(res.outcomes || '') }
      else setErr(res?.error || 'reply failed')
    } finally { setBusy(false) }
  }
  // a frame's own send button presses this composer's send, with whatever the composer holds right now
  useLayoutEffect(() => {
    if (!widgetHost) return undefined
    widgetHost.sendRef.current = () => send()
    return () => { widgetHost.sendRef.current = null }
  })
  const preview = frames.length > 0 || drafts.length > 0 ? (
        <>
          <WidgetDraftQueue drafts={drafts} onDiscard={widgetHost?.discard} />
          {frames.length > 0 && <div className="fv-frames">
            {frames.map((h) => <BlobMedia hash={h} alt="frame" key={h} />)}
          </div>}
        </>
      ) : null
  const editor = (
      <div className="fv-tawrap">
        <ComposerTextarea ref={taRef} className="fv-textarea" rows={1} value={body} placeholder={t('session.issuesReplyPlaceholder')}
          disabled={busy} onChange={(e) => { setBody(e.target.value); ac.sync(e.target) }}
          onSelect={(e) => ac.sync(e.target)} onBlur={() => ac.close()}
          onKeyDown={(e) => { if (composingKey(e)) return; if (ac.onKeyDown(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
        {ac.menuEl}
      </div>
  )
  const footer = (
      /* the buttons swallow mousedown so a click never blurs the textarea; the row itself is persistent. */
      <div className="fv-actions">
        <TriggerButton label={t('thread.mentionActor')} disabled={busy} onClick={() => insertTrigger('@')}>@</TriggerButton>
        <TriggerButton label={t('thread.mentionNode')} disabled={busy} onClick={() => insertTrigger('[[')}>[[</TriggerButton>
        {err && <span className="fv-error">{err}</span>}
        <div className="fv-actions-end">
          {mentioned.map((s) => (
            <button type="button" key={s.id} className="ds-action fv-send-to" disabled={busy || !sendable} data-tip={t('thread.sendToTitle', { to: s.id })}
              onMouseDown={(e) => e.preventDefault()} onClick={() => send([s.id])}>
              <Icon name="send" size={12} />{t('thread.sendTo', { to: sessionHeadline(s) })}
            </button>
          ))}
          {actionsEnd}
          <IconButton icon="send" size={14} className="fv-send" label={busy ? t('session.issuesSending') : t('session.issuesSend')}
            disabled={busy || !sendable} onMouseDown={(e) => e.preventDefault()} onClick={() => send()} />
        </div>
      </div>
  )
  return (
    <ComposerSurface className="fv-compose" preview={preview} editor={editor} footer={footer} />
  )
}

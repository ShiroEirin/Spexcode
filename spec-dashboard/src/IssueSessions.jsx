import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch, postIssueAssign } from './data.js'
import { apiUrl } from './project.js'
import { Icon } from './icons.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import SessionPicker from './SessionPicker.jsx'
import Modal from './Modal.jsx'
import { SideSection, SideValue } from './ReviewShell.jsx'
import { STATUS_COLOR, fleetWorkState, isArchived, issueFleet, issueParticipants, sessionDisplayState, sessionForest, sessionHeadline } from './session.js'
import { fileName, webName } from './resourceCatalog.js'
import { resourceSurface, resourceTabKey } from './sessionSurface.js'
import { useT } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'
import { routeHash } from './route.js'
import { isNewTabGesture, openNewTab } from './tabs.js'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'

// The issue's FLEET on the Issues page ([[issue-binding]]): the sessions bound to this issue, read through the
// ONE join the review package owns and drawn in [[review-chrome]]'s OWN vocabulary — every row is the rail's
// SideValue (a status dot leading a truncating text), every control is the one `ds-action` button, every fact
// in a row's card is another SideValue. Nothing here borrows the console sidebar's row: the rail is a document
// margin, and it reads like the metadata rows around it. Acting on a row goes through the one session context
// menu every list surface opens.

const STRIP_MAX = 4

// the status DOT — the same lead the originator chip wears, painted by the board's STATUS_COLOR.
const StatusDot = ({ s }) => {
  const d = sessionDisplayState(s)
  return <span className="fv-originator-dot" style={{ background: d.color }} aria-hidden="true" />
}

// the compact list-row / status-band face: the row-aside TAG primitive (`rl-tag`) carrying up to STRIP_MAX
// status glyphs in the board's own colours, `+n` past that, toned by the fleet's rolled-up work state.
export function FleetStrip({ fleet = [] }) {
  const t = useT()
  if (!fleet.length) return null
  const state = fleetWorkState(fleet)
  const tip = fleet.map((s) => `${sessionHeadline(s)} · ${t(`status.${sessionDisplayState(s).status}`)}`).join('  /  ')
  return (
    <span className={`rl-tag fv-fleet fv-fleet-${state}`} data-tip={tip} aria-label={t(`fleet.${state}`, { n: fleet.length })}>
      {fleet.slice(0, STRIP_MAX).map((s) => {
        const d = sessionDisplayState(s)
        return <span key={s.id} className="fv-fleet-glyph" style={{ color: d.color }} aria-hidden="true">{d.glyph}</span>
      })}
      {fleet.length > STRIP_MAX && <span>+{fleet.length - STRIP_MAX}</span>}
    </span>
  )
}

// the work-state word beside the issue's own open/closed mark — the same tag primitive, derived, stored nowhere.
export function FleetWorkState({ fleet = [] }) {
  const t = useT()
  if (!fleet.length) return null
  const state = fleetWorkState(fleet)
  return <span className={`rl-tag fv-work fv-work-${state}`}>{t(`fleet.${state}`, { n: fleet.length })}</span>
}

// ONE action per row, gated by the same state facts the console's toolbar gates on (sessionCommands.js):
// a `review` row offers the merge (the only declaration that offers a clickable merge — [[state]]), a
// `retired` row offers close, an offline row offers relaunch. Everything else is a right-click away.
export const railAction = (s) => {
  if (!s) return null
  if (s.status === 'review') return 'merge'
  if (s.status === 'retired') return 'close'
  if (s.liveness === 'offline' && s.status !== 'queued') return 'relaunch'
  return null
}

// the ONE rail control: a quiet outlined button in the rail's own type, a `danger` tone for the destructive verb.
function RailAction({ children, tone = '', ...props }) {
  return <button type="button" className={`ds-action${tone ? ` ${tone}` : ''}`} onMouseDown={(e) => e.preventDefault()} {...props}>{children}</button>
}

// the picked row's CARD: the session's own facts as rail rows — status and note, branch, posted files / web
// services / widgets as REAL anchors into the console surface that shows each ([[resource-tabs]]' address
// grammar) — every fact already on the wire, no second viewer; then the console door.
function FleetCard({ s, issueId, onOpenSession }) {
  const t = useT()
  const d = sessionDisplayState(s)
  const files = s.files || []
  const web = s.web || []
  const widgets = s.widgets || []
  const key = (label) => <span className="ds-side-label fv-card-key">{label}</span>
  const surfaceHref = (kind, value) => routeHash('sessions', s.id, { surface: resourceSurface(resourceTabKey(s.id, kind, value)) })
  return (
    <div className="fv-fleet-card" role="region" aria-label={sessionHeadline(s)}>
      <SideValue lead={key(t('fleet.cardStatus'))} text={`${t(`status.${d.status}`)}${s.note ? ` · ${s.note}` : ''}`} />
      {/* a parent issue's fleet holds its sub-issues' workers: the row names the issue it actually works */}
      {s.issue && s.issue !== issueId && <SideValue lead={key(t('fleet.cardIssue'))} text={s.issue} mono href={routeHash('issues', s.issue)} />}
      {s.branch && <SideValue lead={key(t('fleet.cardBranch'))} text={s.branch} mono />}
      {files.map((p) => <SideValue key={p} lead={key(t('fleet.cardFiles'))} text={fileName(p)} tip={p} href={surfaceHref('file', p)} />)}
      {web.map((w) => <SideValue key={w.key} lead={key(t('fleet.cardWeb'))} text={webName(w.url)} tip={w.url} href={surfaceHref('web', w.key)} />)}
      {widgets.length > 0 && <SideValue lead={key(t('fleet.cardWidgets'))} text={widgets.map((w) => w.name).join(', ')} />}
      {!files.length && !web.length && !widgets.length && <SideValue lead={key('')} text={t('fleet.cardNothing')} dim />}
      <a className="ds-action" href={routeHash('sessions', s.id)} onClick={(e) => { if (isNewTabGesture(e)) return; e.preventDefault(); onOpenSession?.(s.id) }}>
        <Icon name="terminal" size={12} />{t('fleet.openConsole')}
      </a>
    </div>
  )
}


// a session that already CLOSED is off the board, so its name comes from the archive index — the same read the
// console's archive overlay makes — fetched once per id; a name that never resolves stays the short id, honestly.
const archivedNames = new Map()
function useArchivedName(id, onBoard) {
  const [name, setName] = useState(() => archivedNames.get(id) || null)
  useEffect(() => {
    if (!id || onBoard || archivedNames.has(id)) return undefined
    let live = true
    fetch(apiUrl('/api/sessions/archive-index')).then((r) => (r.ok ? r.json() : [])).then((rows) => {
      for (const row of Array.isArray(rows) ? rows : []) archivedNames.set(row.id, row.title || row.label || row.id)
      if (live) setName(archivedNames.get(id) || null)
    }).catch(() => { /* the short id stands */ })
    return () => { live = false }
  }, [id, onBoard])
  return onBoard ? null : name
}

// the thread's VOICES as one list of session chips: the originator first, tagged `opened`; then every other reply
// author outside the fleet. A voice that is still a board session wears its live status dot and opens its console;
// one that has closed wears a `closed` tag and its archived name; a non-session author (a human, a forge login)
// is a plain value. One vocabulary for "who is this" — the session headline — never a bare id where a name exists.
function Voice({ id, sessions, tags = [], onOpenSession }) {
  const t = useT()
  const s = (sessions || []).find((x) => x.id === id) || null
  const archived = useArchivedName(id, !!s)
  const isSessionId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id || '')
  const trail = <>{tags.map((tag) => <span key={tag} className="rl-tag fv-voice-tag">{t(`fleet.${tag}`)}</span>)}{!s && isSessionId && <span className="rl-tag fv-voice-tag">{t('fleet.closedTag')}</span>}</>
  if (s) {
    const d = sessionDisplayState(s)
    return <SideValue text={sessionHeadline(s)} lead={<StatusDot s={s} />} trail={trail} tip={`${s.id} · ${t(`status.${d.status}`)}`} label={sessionHeadline(s)}
      className="fv-originator alive openable" onClick={() => onOpenSession?.(s.id)} />
  }
  if (isSessionId) {
    const dot = <span className="fv-originator-dot" style={{ background: STATUS_COLOR.offline }} aria-hidden="true" />
    return <SideValue text={archived || id.slice(0, 8)} lead={dot} trail={trail} tip={id} label={archived || id} className="fv-originator offline openable" onClick={() => onOpenSession?.(id)} />
  }
  return <SideValue text={id} trail={trail} dim />
}

export default function IssueSessions({ issue, sessions = [], onOpenSession, onWrite, onError, onCompose }) {
  const t = useT()
  const { fleet } = issueFleet(issue, sessions)
  // the thread's other voices, after the originator, outside the fleet
  const participants = issueParticipants(issue, sessions, fleet).filter((s) => s.id !== issue.by)
  const inFleetIds = new Set(fleet.map((s) => s.id))
  const voices = [
    ...(issue.by && !inFleetIds.has(issue.by) ? [{ id: issue.by, tags: ['opened'] }] : []),
    ...participants.map((p) => ({ id: p.id, tags: ['replied'] })),
  ]
  const { expanded, toggle } = useFold()
  const [menu, setMenu] = useState(null)
  const [closeRequest, setCloseRequest] = useState(null)
  const [picked, setPicked] = useState(null)   // the row whose card is open
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState('')         // `<action>:<id>` in flight — one at a time
  const rows = sessionForest(fleet, (id) => expanded.has(id)).filter((item) => item.type === 'row')
  // the assign door offers every retained board session not already in the fleet ([[session-picker]]).
  const inFleet = new Set(fleet.map((s) => s.id))
  const assignable = sessions.filter((s) => s?.id && !isArchived(s) && !inFleet.has(s.id))
  useEscLayer(assigning, () => setAssigning(false))

  const post = async (path, what) => {
    const response = await apiFetch(path, { method: 'POST' })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.ok === false || body?.dispatched === false) onError?.(body?.error || body?.reason || t('fleet.refused', { what }))
  }
  const act = (name, s) => async (e) => {
    e.stopPropagation()
    if (busy) return
    if (name === 'close') { setCloseRequest(s); return }
    setBusy(`${name}:${s.id}`)
    try {
      if (name === 'merge') await post(`/api/sessions/${s.id}/merge`, t('fleet.merge'))
      else if (name === 'relaunch') await post(`/api/sessions/${s.id}/resume`, t('fleet.relaunch'))
    } catch (error) { onError?.(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(''); onWrite?.() }
  }
  // the dispatch door does NOT dispatch: it types the grammar's own `@new:` trigger into the reply composer —
  // the launcher menu opens there exactly as it does for a hand — and the HUMAN's send is the act ([[mentions]],
  // [[composer]]). Every write on this page leaves through the composer's send; a door only prepares it.
  const dispatch = () => onCompose?.('@new:')
  // the assign door binds an EXISTING session ([[issue-binding]]'s third writer): one write, the session is told.
  const assign = async (id) => {
    if (busy || !id || id === 'new') return
    setBusy('assign')
    setAssigning(false)
    try {
      const res = await postIssueAssign(issue.id, id)
      if (res?.ok) await onWrite?.(res.outcomes || '')
      else onError?.(res?.error || t('fleet.refused', { what: t('fleet.assign') }))
    } finally { setBusy('') }
  }
  return (
    <>
      <SideSection label={fleet.length ? `${t('detail.sideSessions')} · ${fleet.length}` : t('detail.sideSessions')}>
        {rows.length > 0 ? (
          <div className="fv-fleet-rows" role="list">
            {rows.map((item) => {
              const s = item.s
              const action = railAction(s)
              const status = t(`status.${sessionDisplayState(s).status}`)
              const open = picked === s.id
              return (
                <div key={s.id} role="listitem" className="fv-fleet-item">
                  {/* the ONE session row every list surface draws ([[session-row]]): its glyph, headline, fold pod and
                      tree rails, re-fitted to the rail by CSS — never a second row face. This rail adds only the
                      opener tag and the state-gated action beside it, and the card under it. */}
                  <div className={`fv-fleet-row${open ? ' open' : ''}`} data-sid={s.id}>
                    <SessionConsoleTreeRow item={item} activeId={open ? s.id : null} onToggleFold={() => toggle(s.id)} rowProps={{
                      'data-tip': s.note ? `${status} · ${s.note}` : status,
                      'aria-expanded': open,
                      onClick: (e) => { if (isNewTabGesture(e)) openNewTab('sessions', s.id); else setPicked((cur) => (cur === s.id ? null : s.id)) },
                      onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, session: s }) },
                    }} />
                    {s.id === issue.by && <span className="rl-tag fv-voice-tag">{t('fleet.opened')}</span>}
                    {action && (
                      <RailAction tone={action === 'close' ? 'danger' : ''} disabled={!!busy} data-tip={t(`fleet.${action}Title`)} onClick={act(action, s)}>
                        {busy === `${action}:${s.id}` ? t('session.issuesActing') : t(`fleet.${action}`)}
                      </RailAction>
                    )}
                  </div>
                  {open && <FleetCard s={s} issueId={issue.id} onOpenSession={onOpenSession} />}
                </div>
              )
            })}
          </div>
        ) : <SideValue text={t('fleet.none')} dim />}
        {/* the voices that are NOT in the fleet — who filed it, who replied — below a hairline in the SAME section:
            one answer to "who is involved", the tags saying how. A voice that is also a fleet row is not repeated;
            its fleet row carries the tag instead. */}
        {voices.length > 0 && (
          <div className="fv-voices">
            {voices.map(({ id, tags }) => <Voice key={id} id={id} sessions={sessions} tags={tags} onOpenSession={onOpenSession} />)}
          </div>
        )}
        <div className="fv-fleet-doors">
          <RailAction disabled={!!busy || !onCompose} data-tip={t('fleet.newWorkerTitle')} onClick={dispatch}>
            <Icon name="plus" size={12} />{t('fleet.newWorker')}
          </RailAction>
          <RailAction disabled={!!busy} data-tip={t('fleet.assignTitle')} aria-haspopup="dialog" onClick={() => setAssigning(true)}>
            {busy === 'assign' ? t('session.issuesActing') : t('fleet.assign')}
          </RailAction>
        </div>
      </SideSection>
      {/* the assign door is the ONE session picker ([[session-picker]]) in the one modal, portaled to the body:
          the rail is a sticky overflow scroller painted under the sticky composer, so a modal drawn inside it
          would sit behind the compose box — as it did. */}
      {assigning && createPortal(
        <Modal title={t('fleet.assignPick')} closeLabel={t('session.issuesCancel')} onClose={() => setAssigning(false)} className="fv-assign-modal">
          {assignable.length
            ? <SessionPicker sessions={assignable} value="" onChange={assign} filter={assignable.length > 5} compact autoFocus ariaLabel={t('fleet.assignPick')} />
            : <SideValue text={t('fleet.assignNone')} dim />}
        </Modal>,
        document.body,
      )}
      {/* the ONE session menu ([[session-console]]) — close/rename/attach/resume for a fleet row, opened here
          exactly as the navigator opens it; this rail owns no selectable list, so it offers no select row. */}
      <SessionContextMenu menu={menu} onClose={() => setMenu(null)} onChanged={() => onWrite?.()} onError={onError}
        closeRequest={closeRequest} onCloseRequestDone={() => setCloseRequest(null)}
        onDetach={(session) => {
          void apiFetch('/api/sessions/reparent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ children: [session.id], parent: null }),
          }).then(() => onWrite?.())
        }} />
    </>
  )
}

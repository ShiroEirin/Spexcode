import { useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch, postIssueAssign, postIssueReply } from './data.js'
import { Icon } from './icons.jsx'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import SessionPicker from './SessionPicker.jsx'
import Modal from './Modal.jsx'
import { SideSection, SideValue } from './ReviewShell.jsx'
import { STATUS_COLOR, fleetWorkState, isArchived, issueFleet, issueParticipants, sessionDisplayState, sessionForest, sessionHeadline } from './session.js'
import { fileName, webName } from './resourceCatalog.js'
import { resourceSurface, resourceTabKey } from './sessionSurface.js'
import { useLaunchers } from './launch.js'
import { useT } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'
import { routeHash } from './route.js'
import { isNewTabGesture, openNewTab } from './tabs.js'

// The issue's FLEET on the Issues page ([[issue-binding]]): the sessions bound to this issue, read through the
// ONE join session.js owns, drawn with the ONE session row every list surface draws, and acted on through the
// ONE session context menu every list surface opens. This file adds no second session model: it is a rail
// section (the forest + one state-gated action per row + a card under the picked row + the dispatch and
// assign doors) and a list-row strip over the same `fleet`.

const STRIP_MAX = 4

// the compact list-row / status-band face: up to STRIP_MAX status glyphs painted by STATUS_COLOR, the rest a
// count, the whole chip toned by the fleet's rolled-up work state. Hover names every session and its status.
export function FleetStrip({ fleet = [], className = '' }) {
  const t = useT()
  if (!fleet.length) return null
  const state = fleetWorkState(fleet)
  const tip = fleet.map((s) => `${sessionHeadline(s)} · ${t(`status.${sessionDisplayState(s).status}`)}`).join('  /  ')
  return (
    <span className={`fv-fleet fv-fleet-${state} ${className}`} data-tip={tip} aria-label={t(`fleet.${state}`, { n: fleet.length })}>
      {fleet.slice(0, STRIP_MAX).map((s) => {
        const d = sessionDisplayState(s)
        return <span key={s.id} className="fv-fleet-glyph" style={{ color: d.color }} aria-hidden="true">{d.glyph}</span>
      })}
      {fleet.length > STRIP_MAX && <span className="fv-fleet-more">+{fleet.length - STRIP_MAX}</span>}
    </span>
  )
}

// the work-state word beside the issue's own open/closed mark — derived from the fleet, stored nowhere.
export function FleetWorkState({ fleet = [] }) {
  const t = useT()
  if (!fleet.length) return null
  const state = fleetWorkState(fleet)
  return <span className={`fv-work fv-work-${state}`}>{t(`fleet.${state}`, { n: fleet.length })}</span>
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

// the picked row's CARD: the session's own facts, every one already on the wire — status and declaration note,
// branch, and its posted files / web services / widgets as REAL anchors into the console surface that shows
// each ([[resource-tabs]]' address grammar), never a second viewer. "Open console" is the same door a row
// click used to be.
function FleetCard({ s, onOpenSession }) {
  const t = useT()
  const d = sessionDisplayState(s)
  const files = s.files || []
  const web = s.web || []
  const widgets = s.widgets || []
  const surfaceHref = (kind, value) => routeHash('sessions', s.id, { surface: resourceSurface(resourceTabKey(s.id, kind, value)) })
  return (
    <div className="fv-fleet-card" role="region" aria-label={sessionHeadline(s)}>
      <span className="k">{t('fleet.cardStatus')}</span>
      <span className="v"><span style={{ color: d.color }}>{t(`status.${d.status}`)}</span>{s.note ? ` · ${s.note}` : ''}</span>
      {s.branch && <><span className="k">{t('fleet.cardBranch')}</span><span className="v">{s.branch}{s.merges ? ` · ${s.merges}×merged` : ''}</span></>}
      {files.length > 0 && <><span className="k">{t('fleet.cardFiles')}</span><span className="v fv-fleet-links">{files.map((p) => <a key={p} href={surfaceHref('file', p)} data-tip={p}>{fileName(p)}</a>)}</span></>}
      {web.length > 0 && <><span className="k">{t('fleet.cardWeb')}</span><span className="v fv-fleet-links">{web.map((w) => <a key={w.key} href={surfaceHref('web', w.key)} data-tip={w.url}>{webName(w.url)}</a>)}</span></>}
      {widgets.length > 0 && <><span className="k">{t('fleet.cardWidgets')}</span><span className="v">{widgets.map((w) => w.name).join(', ')}</span></>}
      {!files.length && !web.length && !widgets.length && <><span className="k" /><span className="v fv-fleet-empty">{t('fleet.cardNothing')}</span></>}
      <a className="fv-close-issue fv-fleet-open" href={routeHash('sessions', s.id)} onClick={(e) => { if (isNewTabGesture(e)) return; e.preventDefault(); onOpenSession?.(s.id) }}>
        <Icon name="terminal" size={12} />{t('fleet.openConsole')}
      </a>
    </div>
  )
}

export default function IssueSessions({ issue, sessions = [], onOpenSession, onWrite, onError }) {
  const t = useT()
  const { fleet } = issueFleet(issue.id, sessions)
  // the originator has its own labelled rail row already; participants are the OTHER thread voices.
  const participants = issueParticipants(issue, sessions, fleet).filter((s) => s.id !== issue.by)
  const { expanded, toggle } = useFold()
  const [menu, setMenu] = useState(null)
  const [closeRequest, setCloseRequest] = useState(null)
  const [picked, setPicked] = useState(null)   // the row whose card is open
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState('')         // `<action>:<id>` in flight — one at a time
  const { launchers, launcher, pickLauncher } = useLaunchers()
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
  // the dispatch door writes the SAME durable token a hand would type ([[mentions]]' `@new`): the reply
  // lands on the thread, the server spawns the worker bound to this issue, and the outcome flashes as every
  // composer dispatch does. No second creation path.
  const dispatch = async () => {
    if (busy) return
    setBusy('new')
    try {
      const res = await postIssueReply(issue.id, launcher ? `@new:${launcher}` : '@new')
      if (res?.ok) await onWrite?.(res.outcomes || '')
      else onError?.(res?.error || t('fleet.refused', { what: t('fleet.newWorker') }))
    } finally { setBusy('') }
  }
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
  // a plain click opens the row's card in place; ctrl/⌘ still opens the console in a new tab ([[tab-strip]]).
  const pick = (s) => (e) => {
    if (isNewTabGesture(e)) { openNewTab('sessions', s.id); return }
    setPicked((cur) => (cur === s.id ? null : s.id))
  }
  const chip = (s) => {
    const d = sessionDisplayState(s)
    const dot = <span className="fv-originator-dot" style={{ background: STATUS_COLOR[d.status] || STATUS_COLOR.idle }} aria-hidden="true" />
    return <SideValue key={s.id} text={sessionHeadline(s)} lead={dot} tip={`${s.id} · ${t(`status.${d.status}`)}`} label={sessionHeadline(s)}
      className="fv-originator alive openable" onClick={() => onOpenSession?.(s.id)} />
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
                <div key={s.id} role="listitem">
                  <div className="fv-fleet-row">
                    <SessionConsoleTreeRow item={item} activeId={open ? s.id : null} onToggleFold={() => toggle(s.id)} rowProps={{
                      'data-sid': s.id,
                      'data-tip': s.note ? `${status} · ${s.note}` : status,
                      'aria-expanded': open,
                      onClick: pick(s),
                      onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, session: s }) },
                    }} />
                    {action && (
                      <button type="button" className={`fv-close-issue fv-life-${action} fv-fleet-act`} disabled={!!busy}
                        data-tip={t(`fleet.${action}Title`)} onMouseDown={(e) => e.preventDefault()} onClick={act(action, s)}>
                        {busy === `${action}:${s.id}` ? t('session.issuesActing') : t(`fleet.${action}`)}
                      </button>
                    )}
                  </div>
                  {open && <FleetCard s={s} onOpenSession={onOpenSession} />}
                </div>
              )
            })}
          </div>
        ) : <span className="fv-fleet-empty">{t('fleet.none')}</span>}
        <div className="fv-fleet-doors">
          <button type="button" className="fv-close-issue fv-life-new" disabled={!!busy} data-tip={t('fleet.newWorkerTitle')}
            onMouseDown={(e) => e.preventDefault()} onClick={dispatch}>
            <Icon name="plus" size={12} />{busy === 'new' ? t('session.issuesActing') : t('fleet.newWorker')}
          </button>
          {launchers.length > 1 && (
            <select className="fv-fleet-launcher" value={launcher || ''} aria-label={t('fleet.launcher')} disabled={!!busy}
              onChange={(e) => pickLauncher(e.target.value)}>
              {launchers.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          )}
          <button type="button" className="fv-close-issue fv-life-assign" disabled={!!busy} data-tip={t('fleet.assignTitle')} aria-haspopup="dialog"
            onMouseDown={(e) => e.preventDefault()} onClick={() => setAssigning(true)}>
            {busy === 'assign' ? t('session.issuesActing') : t('fleet.assign')}
          </button>
        </div>
      </SideSection>
      {participants.length > 0 && (
        <SideSection label={t('detail.sideParticipants')}>
          {participants.map(chip)}
        </SideSection>
      )}
      {/* the assign door is the ONE session picker ([[session-picker]]) in a modal: pick a retained board session
          that is not yet on this issue; the server binds it and tells it. */}
      {/* portaled to the body: the rail is a sticky overflow scroller under the sticky composer's stacking order, and a
          modal drawn inside it would paint behind the compose box — as it did. */}
      {assigning && createPortal(
        <Modal title={t('fleet.assignPick')} closeLabel={t('session.issuesCancel')} onClose={() => setAssigning(false)} className="fv-assign-modal">
          {assignable.length
            ? <SessionPicker sessions={assignable} value="" onChange={assign} filter={assignable.length > 5} compact autoFocus ariaLabel={t('fleet.assignPick')} />
            : <span className="fv-assign-none">{t('fleet.assignNone')}</span>}
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

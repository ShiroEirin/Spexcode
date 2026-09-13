import { useState } from 'react'
import { apiFetch, postIssueReply } from './data.js'
import { Icon } from './icons.jsx'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import { SideSection, SideValue } from './ReviewShell.jsx'
import { STATUS_COLOR, fleetWorkState, issueFleet, issueParticipants, sessionDisplayState, sessionForest, sessionHeadline } from './session.js'
import { useLaunchers } from './launch.js'
import { useT } from './i18n/index.jsx'
import { isNewTabGesture, openNewTab } from './tabs.js'

// The issue's FLEET on the Issues page ([[issue-binding]]): the sessions bound to this issue, read through the
// ONE join session.js owns, drawn with the ONE session row every list surface draws, and acted on through the
// ONE session context menu every list surface opens. This file adds no second session model: it is a rail
// section (the forest + one state-gated action per row + the dispatch door) and a list-row strip over the
// same `fleet`.

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

export default function IssueSessions({ issue, sessions = [], onOpenSession, onWrite, onError }) {
  const t = useT()
  const { fleet } = issueFleet(issue.id, sessions)
  // the originator has its own labelled rail row already; participants are the OTHER thread voices.
  const participants = issueParticipants(issue, sessions, fleet).filter((s) => s.id !== issue.by)
  const { expanded, toggle } = useFold()
  const [menu, setMenu] = useState(null)
  const [closeRequest, setCloseRequest] = useState(null)
  const [busy, setBusy] = useState('')      // `<action>:<id>` in flight — one at a time
  const { launchers, launcher, pickLauncher } = useLaunchers()
  const rows = sessionForest(fleet, (id) => expanded.has(id)).filter((item) => item.type === 'row')

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
  const open = (s) => (e) => {
    if (isNewTabGesture(e)) openNewTab('sessions', s.id)
    else onOpenSession?.(s.id)
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
              return (
                <div className="fv-fleet-row" key={s.id} role="listitem">
                  <SessionConsoleTreeRow item={item} activeId={null} onToggleFold={() => toggle(s.id)} rowProps={{
                    'data-sid': s.id,
                    'data-tip': s.note ? `${status} · ${s.note}` : status,
                    onClick: open(s),
                    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, session: s }) },
                  }} />
                  {action && (
                    <button type="button" className={`fv-close-issue fv-life-${action} fv-fleet-act`} disabled={!!busy}
                      data-tip={t(`fleet.${action}Title`)} onMouseDown={(e) => e.preventDefault()} onClick={act(action, s)}>
                      {busy === `${action}:${s.id}` ? t('session.issuesActing') : t(`fleet.${action}`)}
                    </button>
                  )}
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
        </div>
      </SideSection>
      {participants.length > 0 && (
        <SideSection label={t('detail.sideParticipants')}>
          {participants.map(chip)}
        </SideSection>
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

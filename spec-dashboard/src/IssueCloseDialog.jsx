import { useState } from 'react'
import { createPortal } from 'react-dom'
import Modal from './Modal.jsx'
import { SideValue } from './ReviewShell.jsx'
import { STATUS_COLOR, sessionDisplayState, sessionHeadline } from './session.js'
import { closable, closeAction } from './issueClose.js'
import { useT } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'

// The Close issue confirmation ([[issue-binding]]): two exclusive groups of fleet rows over one action row. The two
// pure questions — which rows are closable, and what one press does — live in issueClose.js; this component only
// draws them and calls the acts its host supplies.

export default function IssueCloseDialog({ issue, fleet, onClose, onDone, onError }) {
  const t = useT()
  const open = fleet.filter((s) => !closable(s))
  // the closable ones lead, pre-picked: the common case is "everything is settled, close it all".
  const ready = fleet.filter(closable)
  const [picked, setPicked] = useState(() => new Set(ready.map((s) => s.id)))
  const [busy, setBusy] = useState(false)
  useEscLayer(true, onClose)
  const action = closeAction(picked, fleet)

  // picking across the boundary switches groups rather than mixing them ([[issue-binding]]).
  const toggle = (s) => setPicked((prev) => {
    const wasClosable = closable(s)
    const crossing = [...prev].some((id) => closable(fleet.find((x) => x.id === id) || {}) !== wasClosable)
    const next = crossing ? new Set() : new Set(prev)
    if (prev.has(s.id) && !crossing) next.delete(s.id)
    else next.add(s.id)
    return next
  })

  const row = (s) => {
    const d = sessionDisplayState(s)
    const dot = <span className="fv-originator-dot" style={{ background: STATUS_COLOR[d.status] || STATUS_COLOR.idle }} aria-hidden="true" />
    return (
      <label className="fv-close-pick" key={s.id}>
        <input type="checkbox" checked={picked.has(s.id)} disabled={busy} onChange={() => toggle(s)} />
        <SideValue text={sessionHeadline(s)} lead={dot} trail={<span className="rl-tag">{t(`status.${d.status}`)}</span>} tip={s.id} />
      </label>
    )
  }

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      const rows = fleet.filter((s) => picked.has(s.id))
      const outcomes = []
      if (action === 'wrap-up') {
        // ask each picked session to end itself; the issue stays open until they declare it ([[state]]: close is human).
        for (const s of rows) {
          const res = await onDone.wrapUp(s.id, issue)
          outcomes.push(res.ok ? t('issueClose.asked', { name: sessionHeadline(s) }) : `${sessionHeadline(s)}: ${res.error}`)
        }
        await onDone.finish(outcomes.join(' · '))
        onClose()
        return
      }
      for (const s of rows) {
        const res = await onDone.closeSession(s.id)
        if (!res.ok) { onError?.(res.error); setBusy(false); return }
        outcomes.push(t('issueClose.closed', { name: sessionHeadline(s) }))
      }
      const res = await onDone.closeIssue()
      if (!res?.ok) { onError?.(res?.error || t('issueClose.refused')); setBusy(false); return }
      await onDone.finish([t('issueClose.issueClosed'), ...outcomes].join(' · '))
      onClose()
    } finally { setBusy(false) }
  }

  return createPortal(
    <Modal title={t('issueClose.title')} closeLabel={t('session.issuesCancel')} onClose={onClose} className="fv-close-modal">
      <p className="fv-close-lead">{t(`issueClose.lead.${open.length ? 'open' : 'settled'}`, { n: fleet.length })}</p>
      {ready.length > 0 && (
        <div className="fv-close-group">
          <span className="ds-side-label">{t('issueClose.groupReady')}</span>
          {ready.map(row)}
        </div>
      )}
      {open.length > 0 && (
        <div className="fv-close-group">
          <span className="ds-side-label">{t('issueClose.groupOpen')}</span>
          {open.map(row)}
        </div>
      )}
      <div className="fv-close-actions">
        <button type="button" className="ds-action" disabled={busy} onClick={onClose}>{t('session.issuesCancel')}</button>
        <button type="button" className={`ds-action${action === 'wrap-up' ? '' : ' danger'}`} disabled={busy} onClick={confirm}>
          {busy ? t('session.issuesActing') : t(`issueClose.do.${action}`, { n: picked.size })}
        </button>
      </div>
    </Modal>,
    document.body,
  )
}

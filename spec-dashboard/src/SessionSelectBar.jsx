import { useRef, useState } from 'react'
import { apiFetch } from './data.js'
import { IconButton } from './icons.jsx'
import SessionCloseDialog from './SessionCloseDialog.jsx'
import { useT } from './i18n/index.jsx'

// Selection owns only the set of rows and the one bulk verb. Lifecycle semantics remain the same close
// endpoint used by the single-row menu; this bar never invents a second delete operation.
export default function SessionSelectBar({ ids, onCancel, onClosed }) {
  const t = useT()
  const [confirming, setConfirming] = useState(null)
  const completed = useRef(new Set())
  const confirmClose = async () => {
    const results = await Promise.allSettled(confirming.filter((id) => !completed.current.has(id)).map(async (id) => {
      const response = await apiFetch(`/api/sessions/${id}/close`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok || body?.ok !== true) throw new Error(`${id}: ${body?.error || `session close unconfirmed (HTTP ${response.status})`}`)
      completed.current.add(id)
    }))
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length) throw new Error(failures.map((result) => result.reason.message || String(result.reason)).join('\n'))
  }
  return <>
    <div className="si-selbar">
      <span className="si-selcount">{t('sessionSelect.selected', { n: ids.length })}</span>
      <IconButton icon="trash" size={14} className="si-selaction danger" label={t('sessionSelect.close')}
        disabled={!ids.length || !!confirming} onClick={() => { completed.current.clear(); setConfirming([...ids]) }} />
      <IconButton icon="x" size={14} className="si-selaction" label={t('common.cancel')} onClick={onCancel} />
    </div>
    {confirming && <SessionCloseDialog count={confirming.length} onConfirm={confirmClose} onClose={() => {
      setConfirming(null)
      if (completed.current.size) onClosed?.()
    }} />}
  </>
}

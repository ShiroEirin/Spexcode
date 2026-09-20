import { useState } from 'react'
import { apiFetch } from './data.js'
import { IconButton } from './icons.jsx'
import SessionCloseDialog from './SessionCloseDialog.jsx'
import { useT } from './i18n/index.jsx'

// Selection owns only the set of rows and the one bulk verb. Lifecycle semantics remain the same close
// endpoint used by the single-row menu; this bar never invents a second delete operation.
export default function SessionSelectBar({ ids, onCancel, onClosed }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const confirmClose = async () => {
    const responses = await Promise.all(ids.map((id) => apiFetch(`/api/sessions/${id}/close`, { method: 'POST' }).then(async (response) => {
      if (response.ok) return
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || `session close refused (HTTP ${response.status})`)
    })))
    return responses
  }
  return <>
    <div className="si-selbar">
      <span className="si-selcount">{t('sessionSelect.selected', { n: ids.length })}</span>
      <IconButton icon="trash" size={14} className="si-selaction danger" label={t('sessionSelect.close')}
        disabled={!ids.length} onClick={() => setConfirming(true)} />
      <IconButton icon="x" size={14} className="si-selaction" label={t('common.cancel')} onClick={onCancel} />
    </div>
    {confirming && <SessionCloseDialog count={ids.length} onConfirm={async () => { await confirmClose(); onClosed?.() }} onClose={() => setConfirming(false)} />}
  </>
}

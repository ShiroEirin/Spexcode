import Modal from './Modal.jsx'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

export default function SessionCloseDialog({ name, count = null, onConfirm, onClose }) {
  const t = useT()
  useEscLayer(true, onClose)
  const title = count !== null
    ? t('sessionSelect.closeTitle', { n: count })
    : t('sessionWindow.closeTitle', { name })

  return (
    <Modal title={title} closeLabel={t('common.close')} onClose={onClose} className="sess-rename-modal">
      <div className="sess-confirm">
        <p className="sess-confirm-msg">{count !== null ? t('sessionSelect.closeConfirm') : t('sessionWindow.closeConfirm')}</p>
        <div className="sess-rename-actions">
          <button type="button" className="sess-rename-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="sess-rename-btn danger" onClick={() => { onConfirm(); onClose() }} autoFocus>
            {t('sessionWindow.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

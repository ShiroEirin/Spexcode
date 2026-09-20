import { useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import { Icon } from './icons.jsx'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

// Close is a long transaction, not a click. Keep the confirmation surface mounted until the request has
// either been accepted or rejected, so the human never has to infer whether the destructive action landed.
export default function SessionCloseDialog({ name, count = 1, onConfirm, onClose }) {
  const t = useT()
  const [phase, setPhase] = useState('confirming')
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  const dismiss = () => {
    if (phase === 'working') return
    onClose?.()
  }

  const confirm = async () => {
    if (phase === 'working') return
    setError('')
    setPhase('working')
    try {
      await onConfirm?.()
      setPhase('succeeded')
      timerRef.current = window.setTimeout(() => onClose?.(), 900)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('failed')
    }
  }

  const retry = () => {
    setError('')
    setPhase('confirming')
  }
  useEscLayer(true, dismiss)
  const title = count > 1
    ? t('sessionSelect.closeTitle', { n: count })
    : t('sessionWindow.closeTitle', { name })

  return (
    <Modal title={phase === 'working' ? t('sessionWindow.closeWorkingTitle') : title}
      closeLabel={t('common.close')} closeDisabled={phase === 'working'} onClose={dismiss} className="sess-rename-modal">
      {phase === 'confirming' && (
        <div className="sess-confirm">
          <p className="sess-confirm-msg">{count > 1 ? t('sessionSelect.closeConfirm') : t('sessionWindow.closeConfirm')}</p>
          <div className="sess-rename-actions">
            <button type="button" className="sess-rename-btn" onClick={dismiss}>{t('common.cancel')}</button>
            <button type="button" className="sess-rename-btn danger" onClick={confirm} autoFocus>
              {t('sessionWindow.close')}
            </button>
          </div>
        </div>
      )}
      {phase === 'working' && (
        <div className="sess-close-progress" role="status" aria-live="polite">
          <Icon name="loader" size={20} className="sess-close-spinner" />
          <div>
            <strong>{t('sessionWindow.closeWorking')}</strong>
            <p className="sess-close-detail">{t('sessionWindow.closeWorkingDetail')}</p>
          </div>
        </div>
      )}
      {phase === 'succeeded' && (
        <div className="sess-close-progress succeeded" role="status" aria-live="polite">
          <Icon name="circle-check" size={20} />
          <div>
            <strong>{t('sessionWindow.closeSucceeded')}</strong>
            <p className="sess-close-detail">{t('sessionWindow.closeSyncing')}</p>
          </div>
        </div>
      )}
      {phase === 'failed' && (
        <div className="sess-confirm">
          <div className="sess-close-error" role="alert">
            <Icon name="triangle-alert" size={17} />
            <span>{error || t('sessionWindow.closeFailed')}</span>
          </div>
          <div className="sess-rename-actions">
            <button type="button" className="sess-rename-btn" onClick={dismiss}>{t('common.cancel')}</button>
            <button type="button" className="sess-rename-btn danger" onClick={retry}>{t('sessionWindow.closeRetry')}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

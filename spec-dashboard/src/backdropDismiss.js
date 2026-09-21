import { useCallback, useRef } from 'react'

// A backdrop click is only a dismissal when the same pointer gesture began on the backdrop. Without this
// origin check, a text selection that leaves a panel can synthesize its release as a click on the backdrop.
export function isBackdropTarget(event) {
  return event?.target === event?.currentTarget
}

export function useBackdropDismiss(onClose) {
  const startedOnBackdrop = useRef(false)
  const rememberOrigin = useCallback((event) => {
    startedOnBackdrop.current = isBackdropTarget(event)
  }, [])
  const dismiss = useCallback((event) => {
    const started = startedOnBackdrop.current
    startedOnBackdrop.current = false
    if (!started || !isBackdropTarget(event)) return
    onClose?.(event)
  }, [onClose])
  const cancel = useCallback(() => { startedOnBackdrop.current = false }, [])

  return {
    onPointerDownCapture: rememberOrigin,
    onMouseDownCapture: rememberOrigin,
    onPointerCancel: cancel,
    onClick: dismiss,
  }
}

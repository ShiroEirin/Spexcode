// CSS classes are named `legend-*` for history (the legend was the first such modal); shared verbatim by every popup.
// A direct backdrop click closes; the shared gesture seam keeps a drag that starts in the panel from closing.
import { useEffect } from 'react'
import { IconButton } from './icons.jsx'
import { returnFocus } from './focus.js'
import { useBackdropDismiss } from './backdropDismiss.js'

export default function Modal({ title, closeLabel, onClose, className, children }) {
  const backdropProps = useBackdropDismiss(onClose)
  // a modal returns the focus it took ([[focus-return]]): whichever way it closes — Esc, backdrop,
  // cancel, submit — unmount hands focus back to the ticket, else the surface's sink. Never <body>.
  useEffect(() => () => returnFocus(), [])
  return (
    <div className="legend-backdrop" data-focus-overlay {...backdropProps}>
      <div
        className={className ? `legend ${className}` : 'legend'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="legend-head">
          <span className="legend-title">{title}</span>
          <IconButton icon="x" size={13} className="legend-close" label={closeLabel} onClick={onClose} />
        </div>
        <div className="legend-body">{children}</div>
      </div>
    </div>
  )
}

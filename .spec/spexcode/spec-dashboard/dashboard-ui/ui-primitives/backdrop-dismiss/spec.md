---
title: backdrop-dismiss
status: active
hue: 215
desc: One outside-close gesture boundary shared by transient overlays.
code:
  - spec-dashboard/src/backdropDismiss.js
related:
  - spec-dashboard/src/backdropDismiss.test.mjs
  - spec-dashboard/src/Modal.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/Evidence.jsx
  - spec-dashboard/src/SessionInterface.jsx
---

# backdrop-dismiss

## raw source

An overlay may close when a human clicks its backdrop, but selecting text inside the overlay is not that
gesture. A press that starts in the panel and releases outside can synthesize a click whose target is the
backdrop; the shared boundary remembers where the press began so that release cannot dismiss the surface.

## expanded spec

Every transient overlay that closes from a backdrop uses one `useBackdropDismiss` seam. The seam records
whether the pointer press began on the backdrop itself and closes only when the resulting click still lands
on that same backdrop. A press beginning in any panel content — including an input or textarea — never closes
the overlay merely because its selection crosses the panel edge. A normal backdrop click remains a close,
and clicks on panel content remain panel-owned. Pointer and mouse press paths share the same rule; cancellation
clears the remembered gesture, while a later press always establishes a fresh origin.

The seam owns only this gesture boundary. Overlay-specific focus return, Escape ownership, and action
semantics remain with their existing shared mechanisms and callers.

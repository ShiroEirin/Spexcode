---
title: attach-queue
status: active
hue: 170
desc: The one client hook behind every composer's attachment control — paste, drop and pick become one queued transfer, per-file rows, and sink-specific text spliced at the caret.
code:
  - spec-dashboard/src/useAttachQueue.jsx
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/conversation-command-box.e2e.mjs
  - spec-dashboard/test/attachment-complete.e2e.mjs
---

# attach-queue

[[file-attach]] states the session contract — a file attached to an authored session composer is carried to the
machine the session runs on and the draft is left holding its absolute path. Issue composers use the same hook
with the `evidence` sink: bytes are stored in the shared content-addressed evidence cache and the draft is left
holding `![name](/api/evidence/<hash>)`. This node is that contract's client half as ONE hook, `useAttachQueue`,
which every authored composer instantiates for its own textarea. A composer that renders the hook's attachment
control has the complete gesture set and queue; there is no second attachment mechanism.

The hook is pointed at a composer by its textarea ref and value setter. Its `sink` is `uploads` by default (the
resumable `/api/uploads` stream and path splice); `evidence` posts the exact file bytes to `/api/evidence`,
reports the same queued/uploading/complete/cancelled/failed rows and progress, and splices a markdown image link
using the returned hash. The evidence sink accepts any file type; rendering later is decided by the blob's served
Content-Type, not by a client-side image-only check. It owns: the three gestures (a paste
carrying files claims the event, a plain text paste falls through; a drag over the surface reports `dragging`
so the host can ring, a drop attaches; `pick` clicks the hidden `<input type=file>` the hook itself renders);
the transfer loop over [[file-attach]]'s resumable stream — create, ordered chunk `PATCH`es with the committed
offset, the policy-bounded transient retries, `complete` — with one transfer at a time by default and more
only when the policy the first transfer returns allows it; the per-file rows (name, bytes sent as a progress
bar, `queued` / bytes / `attached` / `cancelled` / the concrete failure, retry and cancel controls, the
completed row's fade-and-remove); and the splice. The splice pads the returned path with spaces so it never
glues to a neighbouring word and parks the caret after it. Each row captures the splice for the composer it was
attached FROM when it was queued, so a host that re-points the hook mid-upload (a session switch) still lands
the path in the draft that asked for it; a composer whose textarea is no longer mounted receives the path
appended through its functional setter rather than a stale copy of its draft.

`disabled` makes every gesture inert — an offline or archived session has no live machine to carry a file to —
and `variant` picks the row styling for a centered launch box or a docked composer card. A cap, capacity,
malformed-offset or write failure the backend names arrives in the row as that reason; nothing is spliced.

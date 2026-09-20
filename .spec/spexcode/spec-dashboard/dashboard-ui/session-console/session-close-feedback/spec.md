---
title: session-close-feedback
status: active
hue: 300
desc: Closing a session acknowledges the request without holding the workspace hostage.
code:
  - spec-dashboard/src/SessionCloseProvider.jsx
related:
  - spec-dashboard/src/SessionCloseDialog.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionSelectBar.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/test/session-close-freshness.e2e.mjs
---
# session-close-feedback

## raw source

“现在是 blocking 的，还要用户在旁边等。。。不太好吧。” Confirmation is a decision;
waiting for close must not occupy the user or block unrelated work.

## expanded spec

The dialog owns only confirmation. Confirm synchronously registers each target with the project page's
request owner and dismisses the dialog immediately. Bulk selection also exits immediately. No modal working
phase, completion delay, or batch-level retry state remains.

One request owner, mounted outside routed documents and the dock, sends the existing close endpoint and
tracks pending and failed requests by session id. Single-row, archive-drop, and bulk entrypoints use it.
A second submission for an id already pending sends no second request. Each batch member settles independently;
retrying a failed member does not reclose successful or pending siblings. There is no automatic failure retry
in this owner, parent/child close ordering algorithm, or second cleanup authority.

The shared session row shows an additional spinner and “closing” label while its request is pending, preserving
the canonical lifecycle glyph. Users can navigate, type in another session, and hide/reopen the dock while
the request continues. A response must be HTTP success with JSON `ok: true` to count as acknowledged. Success
refreshes the board and uses the existing non-modal success notice; rows disappear through the actual board,
never through optimistic hiding. Failure retains its reason in an existing persistent, non-modal notification
with an explicit retry action and marks the row. Retrying withdraws the preceding failure notice. An authoritative
board removal clears stale failure feedback, so an old notification cannot later reclose a restored session.

This is browser-memory request feedback, not session lifecycle or durable operation storage. It survives
route/dock changes within the mounted project page, not a page reload or authentication teardown. Reload reads
the backend's actual state; no request is automatically replayed. A transport failure means success was not
confirmed, not proof that the backend did nothing. Backend close guards and archive publication remain unchanged.

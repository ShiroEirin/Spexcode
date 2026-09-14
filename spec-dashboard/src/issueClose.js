import { sessionDisplayState } from './session.js'

// Closing an issue while the sessions that carry it are still open leaves the board lying: the issue reads finished
// and its workers read busy. The Close issue act therefore asks first, over the FLEET only ([[issue-binding]]) — the
// thread's other voices carry no work. These are its two pure questions; the dialog holds no state beyond the picked
// set, so what one press does is always derived from that set.

// A session that has settled ITSELF is closable: close-pending is its own declaration, retired means its worktree is
// already gone. Everything else — working, asking, parked, review, error — is live work the human should not close
// behind its back; the honest move there is to ask it to wrap up so it declares its own end ([[state]]).
export const CLOSABLE = new Set(['close-pending', 'retired'])
export const closable = (s) => CLOSABLE.has(sessionDisplayState(s).status)

// what one press will do. The two groups are exclusive because they are two different acts, so a set that somehow
// mixes them reads as the safer half: nothing live gets closed by surprise.
export const closeAction = (picked, fleet = []) => {
  if (!picked?.size) return 'issue-only'
  const rows = fleet.filter((s) => picked.has(s.id))
  return rows.length > 0 && rows.every(closable) ? 'close-with' : 'wrap-up'
}

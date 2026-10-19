// @@@ kill-tree - end a child process AND its descendants, on every platform this product runs on.
//
// WHY this exists: POSIX callers kill a spawned tree by signalling the child's process GROUP —
// `process.kill(-pid, sig)`. That spelling depends on process groups and negative-pid signalling, which
// Windows does not have: the call throws `ESRCH` for a child that is alive and well. Every caller here
// wrapped it in a `catch` whose comment says "group may already be gone", so on Windows the failure was
// silent: the child (and anything it spawned) SURVIVED.
//
// That is not cosmetic. A backend spawned with pipe stdio keeps the pipes open, and a Node test process
// with an open pipe never reaches its exit condition — so a suite that kills its fixture this way hangs
// forever on Windows instead of finishing. The same silent survival also leaks real agent processes in
// the product. Windows needs a DIFFERENT mechanism (`taskkill /T` walks the descendant tree), so the
// decision belongs in one place rather than repeated at every call site.
//
// CONTRACT: this is the ONE way to end a spawned tree. Callers pass the pid they spawned; the child
// handle is optional and used only for the direct-kill fallback. The function never throws — a tree that
// is already gone is success, and the callers are teardown paths where a throw would replace the real
// failure with a teardown failure.
import { spawnSync } from 'node:child_process'

export type KillableChild = { pid?: number | undefined; kill: (signal?: NodeJS.Signals | number) => boolean }

// Does `pid` still exist? Signal 0 is the portable existence probe.
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * End `child` and every process below it.
 *
 * `signal` is honoured on POSIX (SIGTERM lets a well-behaved child clean up; SIGKILL does not). Windows has
 * no signals and no polite tree-close for a console child, so the forced tree reaper is used there and the
 * signal is ignored.
 */
export function killTree(child: KillableChild | number, signal: NodeJS.Signals = 'SIGKILL'): void {
  const pid = typeof child === 'number' ? child : child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    // `/T` includes descendants — the whole reason the POSIX group kill cannot be reused here. A console
    // child has no window to receive WM_CLOSE, so `taskkill /T` WITHOUT `/F` answers "this process can only
    // be terminated forcefully" and leaves it alive (measured on Windows 11); the polite half POSIX buys
    // with SIGTERM has no analog here. The reaper is therefore always forced.
    const result = spawnSync(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    )
    // spawnSync reports a missing binary or a non-zero taskkill in its RETURN value; it never throws.
    if (result.error || result.status !== 0) {
      // No usable tree reaper: the direct handle is the only remaining way to end the child.
      if (typeof child !== 'number') {
        try { child.kill(signal) } catch { /* already exited */ }
      }
    }
    return
  }

  // POSIX: the child was spawned `detached`, so it leads its own process group and the negative pid
  // addresses the whole tree. The direct kill is the fallback for a child that was NOT detached (or a
  // group that is already gone).
  try { process.kill(-pid, signal) } catch { /* group may already be gone */ }
  if (typeof child !== 'number') {
    try { child.kill(signal) } catch { /* already exited */ }
  }
}

/**
 * End a spawned tree politely, then forcibly. The shape every teardown wants: give a well-behaved child
 * a moment to release its handles, then make sure it is gone before the caller continues. On Windows the
 * first killTree is already forced, so the grace period only ever elapses on POSIX.
 */
export async function killTreeAndWait(child: KillableChild | number, graceMs = 500): Promise<void> {
  const pid = typeof child === 'number' ? child : child.pid
  if (!pid) return
  killTree(child, 'SIGTERM')
  if (!isAlive(pid)) return
  await new Promise((done) => setTimeout(done, graceMs))
  if (isAlive(pid)) killTree(child, 'SIGKILL')
}

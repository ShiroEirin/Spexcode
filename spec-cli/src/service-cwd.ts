import { statSync } from 'node:fs'
import { resolve } from 'node:path'

// A long-lived process states the directory it stands on ([[service-cwd]]); what it inherited from its launcher
// belongs to the launcher. chdir also drops Node's cached process.cwd(), which otherwise keeps answering with a
// path long after the directory behind it died — the reason a process in that state looks healthy from inside.
export function anchorServiceCwd(dir: string): string {
  const anchored = resolve(dir)
  process.chdir(anchored)
  return anchored
}

// null while `dir` is still the directory this process stands on, else what happened to it. `.` asks the kernel
// for the directory actually held, so a removal, a rename into a trash, and a fresh directory recreated at the
// same path are all told apart from "still here" without remembering anything from startup.
export function serviceCwdLoss(dir: string): string | null {
  let held, named
  try { held = statSync('.') } catch (error) { return `the directory this process stands on is unreadable (${(error as Error).message})` }
  try { named = statSync(dir) } catch (error) { return `${dir} is gone (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})` }
  return held.dev === named.dev && held.ino === named.ino ? null : `${dir} is no longer the directory this process stands on`
}

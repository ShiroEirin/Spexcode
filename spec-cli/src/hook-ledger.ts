import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runtimeRoot } from '@spexcode/spec-core'

// @@@the-only-place-that-sees-every-run - a hook's activity cannot be sampled or inferred: it is written by
// the dispatcher, which IS the thing that runs every handler on every event in every tree of this project
// ([[dispatcher-runtime]]). So these counts are exact for the window they cover, and the window is the whole
// of what they claim. What they count is a DISPATCH: a hook the active profile turned off is still dispatched
// and exits as a no-op, so it appears here as a run — which is the truth about what the event paid for it.
//
// @@@a-run-that-was-killed-is-not-a-run-that-did-not-happen - each handler writes `start` before it runs and
// `done` after, so a dispatch the harness killed mid-way is a start with no done. Counting only `done` lines
// keeps every average honest, and the leftover starts are reported separately rather than silently dropped.

const LEDGER_DIR = 'hook-ledger'
// the reader's window. The dispatcher appends forever and deletes nothing; a reader that promised "all time"
// would grow without bound and lie the day someone trims the directory. So it reads the most recent days and
// says which day it started from — a number with its window stated is a fact, one without is a guess.
const MAX_DAYS = 30

export type HookActivity = {
  runs: number
  refusals: number
  failures: number
  unfinished: number
  lastMs: number | null
  medianMs: number | null
  lastRefusal: { atMs: number; reason: string } | null
}
export type LedgerView = {
  available: boolean
  sinceDay: string | null
  days: number
  runs: number
  byHook: Record<string, HookActivity>
}

const empty = (): HookActivity => ({ runs: 0, refusals: 0, failures: 0, unfinished: 0, lastMs: null, medianMs: null, lastRefusal: null })

function dayFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.tsv$/.test(name)).sort().slice(-MAX_DAYS)
  } catch { return [] }
}

// ts_ms phase session harness event hook order code block ms reason
export function readLedger(proj?: string): LedgerView {
  let dir: string
  try { dir = join(runtimeRoot(proj), LEDGER_DIR) } catch { return { available: false, sinceDay: null, days: 0, runs: 0, byHook: {} } }
  const files = dayFiles(dir)
  if (files.length === 0) return { available: false, sinceDay: null, days: 0, runs: 0, byHook: {} }

  const byHook = new Map<string, HookActivity>()
  const durations = new Map<string, number[]>()
  const starts = new Map<string, number>()
  let runs = 0
  for (const file of files) {
    let text: string
    try { text = readFileSync(join(dir, file), 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line) continue
      const [ts, phase, , , , hook, , code, block, ms, reason] = line.split('\t')
      if (!hook) continue
      const at = Number(ts)
      if (!Number.isFinite(at)) continue
      if (phase === 'start') { starts.set(hook, (starts.get(hook) || 0) + 1); continue }
      if (phase !== 'done') continue
      const row = byHook.get(hook) || empty()
      row.runs += 1
      runs += 1
      if (block === '1') {
        row.refusals += 1
        row.lastRefusal = { atMs: at, reason: reason || '' }
      } else if (code && code !== '0') row.failures += 1
      if (row.lastMs === null || at > row.lastMs) row.lastMs = at
      const took = Number(ms)
      if (Number.isFinite(took)) {
        const list = durations.get(hook) || []
        list.push(took)
        durations.set(hook, list)
      }
      byHook.set(hook, row)
    }
  }
  for (const [hook, list] of durations) {
    list.sort((a, b) => a - b)
    const row = byHook.get(hook)
    if (row) row.medianMs = list[Math.floor(list.length / 2)] ?? null
  }
  // a start the dispatch never finished: the handler was killed, or the whole harness was. Reported, never
  // folded into `runs`, because a run with no outcome has no exit code, no duration, and no verdict.
  for (const [hook, count] of starts) {
    const row = byHook.get(hook) || empty()
    row.unfinished = Math.max(0, count - row.runs)
    byHook.set(hook, row)
  }
  return {
    available: true,
    sinceDay: files[0].replace('.tsv', ''),
    days: files.length,
    runs,
    byHook: Object.fromEntries(byHook),
  }
}

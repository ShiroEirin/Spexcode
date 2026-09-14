// @@@ write-time attribution ([[issue-binding]]) - the read side attributes a declaration by the
// `[[issue:<id>]]` reference in its note: unqualified is accepted only from a session carrying exactly ONE
// issue, so a session carrying several that declares without naming one contributes a row to NONE of them.
// That was silent, and measured on real workers it happened every time (0/2 multi-issue declarations named
// their issue). This is that silence spoken at the moment of the write — the same grammar reading the same
// note ([[mentions]]), beside the declaration's own receipt. Advisory, never a gate: a declaration must land
// even when nobody will read it on an issue page, because the timeline is its first home ([[state]]). It states
// the local fact and nothing the skill already teaches — the two are read in one context.

import { parseMentions } from './mentions.js'

export function attributionNudge(issues: readonly string[], note?: string | null): string {
  if (issues.length < 2) return ''
  const named = note ? parseMentions(note).issues : []
  if (named.some((id) => issues.includes(id))) return ''
  const stray = named.length ? ` It names ${named.map((id) => `[[issue:${id}]]`).join(', ')}, which is not one of them.` : ''
  return `\n\nThis note names no issue of yours (you carry ${issues.length}: ${issues.join(', ')}), so it appears on NONE of them.${stray}` +
    ` Re-declare with the issue in the note: [[issue:${issues[0]}]].`
}

// the record read, kept off the declaration path: an advisory that cannot be computed prints nothing rather
// than standing between an agent and its own state write.
export async function declarationAttributionNudge(sessionId: string | null | undefined, note?: string | null): Promise<string> {
  if (!sessionId) return ''
  try {
    const { readRecord } = await import('./session-record.js')
    return attributionNudge(readRecord(sessionId)?.issues ?? [], note)
  } catch { return '' }
}

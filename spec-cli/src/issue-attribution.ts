// @@@ write-time attribution ([[issue-binding]]) - the read side attributes a declaration by the
// `[[issue:<id>]]` reference in its note: unqualified is accepted only from a session carrying exactly ONE
// issue, so a session carrying several that declares without naming one contributes a row to NONE of them.
// That was silent, and measured on real workers it happened every time (0/2 multi-issue declarations named
// their issue). This is that silence spoken at the moment of the write — the same grammar reading the same
// note ([[mentions]]), beside the declaration's own receipt. Advisory, never a gate: a declaration must land
// even when nobody will read it on an issue page, because the timeline is its first home ([[state]]).

import { parseMentions } from './mentions.js'

export function attributionNudge(issues: readonly string[], note?: string | null): string {
  if (issues.length < 2) return ''
  const named = note ? parseMentions(note).issues : []
  if (named.some((id) => issues.includes(id))) return ''
  const stray = named.length ? ` Your note names ${named.map((id) => `[[issue:${id}]]`).join(', ')}, which is not one of them.` : ''
  return `\n\nThis declaration names no issue of yours, and your session carries ${issues.length}: ${issues.join(', ')}.` +
    `${stray} An issue page attributes a declaration by the \`[[issue:<id>]]\` reference in its note, so this one appears on NONE of your issues` +
    ` — the human watching them sees you working and nothing else. Re-declare with the issue named in the note` +
    ` (…--note "<what you said> [[issue:${issues[0]}]]"), naming each issue the declaration is about.`
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

import { spexEnvelope } from '@spexcode/transcript-ui'

// MESSAGES, SEAMS, AND EVENTS — the three things the Conversation shows, derived from a session's timeline in
// wire order. The status machine wrote the timeline (`working` ↔ `asking` ↔ `working` …), but a reader is not
// reading the machine: a stretch in which the agent said nothing and worked is one SEAM that carries the
// transcript for exactly that interval; anything said — a note, a sent message — is a message; `error` and
// `corrupt` are events that happened, not phases that lasted.
//
// THE ONE INVARIANT: the items partition the session's time, and no stretch of work is ever dropped. The record
// says the agent is working only ONCE — a later message or note lands on that working agent without any
// further status event (the state machine is idempotent) — so the derivation carries the agent's state forward
// itself: after every message or note, a working agent is working on it from that instant, and a seam opens
// there. Hence the theorem the page relies on: if the record's last word is `working`, the last item is an
// open seam — mid-history stretches get their `worked …` disclosure, and the live tail is always present.
//
// A WINDOW IS NOT THE WHOLE HISTORY, so the word carried forward has to be given to it. `priorWorking` is what
// the events before this window already said ([[session-timeline]] derives it server-side): without it a
// window that opens mid-stretch starts from `false` and silently drops the stretch of work it began inside.
//
// The open tail seam has NO end here. Its end is the reader's present, which moves every second, and putting
// a moving number in the derivation made the whole conversation rebuild on each tick for one line of text.
// The caller owns that clock: an open seam is `to: undefined`, and whoever needs an interval for it says so.

export const epochOf = (ts) => typeof ts === 'number' ? ts : Date.parse(ts)

// The envelope `spex session send` appends is addressing, not what the peer said. The server's one prompt
// seam still ships it inside the text, so this surface strips it to render the message and keeps only the
// sender name it carries; the record itself is untouched. The parser is the transcript package's own row
// (`spexEnvelope`), so the outer conversation and a quoted turn inside a transcript read one format.
export function splitEnvelope(text) {
  const envelope = spexEnvelope(text || '')
  if (!envelope) return { text, envelope: null }
  return { text: envelope.body, envelope: { label: envelope.who === envelope.id ? null : envelope.who, id: envelope.id } }
}

// A MANAGED WATCH NOTICE IS NOT SPEECH. The wire marks what a watch delivered (`system: 'watch'`, derived from the
// message's key, [[session-timeline]]): the system describing ANOTHER session's state. It neither closes a stretch
// of work nor opens one. Landing on a working agent it belongs to the seam it arrived inside (`seam.notices`);
// landing on an agent that is not working it joins the notices right before it, as one `notices` item. Either
// way a run of them stays one run, which is what lets the page fold a supervisor's burst behind a count.
// The one producer writes `[spex watch] <id> is <word> — <note>` ([[session-follow]]); a text that does not read
// that way keeps its whole text as the note rather than vanishing.
const WATCH_NOTICE = /^\[spex watch\] (\S+) is (\S+)(?: — ([\s\S]*))?$/
export function watchNotice(event) {
  const match = WATCH_NOTICE.exec(event.text || '')
  return match
    ? { ts: event.ts, mid: event.mid, from: event.from || match[1], status: match[2], note: match[3] || null }
    : { ts: event.ts, mid: event.mid, from: event.from, status: null, note: event.text || null }
}

export function conversationItems(events, priorWorking = false) {
  const items = []
  let seam = null
  let working = !!priorWorking   // the record's last word about the agent, carried across the events that do not repeat it
  const open = (ts) => { seam ??= { kind: 'seam', ts, from: epochOf(ts), notices: [] } }
  const close = (to, open = false) => {
    if (seam) items.push({ ...seam, to, open })
    seam = null
  }
  for (const event of events) {
    if (event.kind === 'sent' && event.system === 'watch') {
      const notice = watchNotice(event)
      const last = items.at(-1)
      if (working) { open(event.ts); seam.notices.push(notice) }
      else if (last?.kind === 'notices') last.notices.push(notice)
      else items.push({ kind: 'notices', ts: event.ts, notices: [notice] })
      continue
    }
    const status = event.display || event.status
    if (event.kind === 'status') working = status === 'working'
    if (event.kind === 'status' && working && !event.note) { open(event.ts); continue }
    close(epochOf(event.ts))
    if (event.kind === 'sent') items.push({ kind: 'quote', ts: event.ts, from: event.from, ...splitEnvelope(event.text) })
    else if (status === 'error' || status === 'corrupt') items.push({ kind: 'event', ts: event.ts, status, text: event.note })
    else items.push({ kind: 'say', ts: event.ts, status, text: event.note })
    if (working) open(event.ts)
  }
  if (seam) close(undefined, true)
  return items
}

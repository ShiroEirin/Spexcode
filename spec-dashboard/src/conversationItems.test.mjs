import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationItems, splitEnvelope, watchNotice } from './conversationItems.js'
import { SCENARIOS, at, sent, status } from '../test/fixtures/conversation-tail.scenarios.mjs'
import en from './i18n/en.js'

const shape = (item) => item.kind === 'seam' ? { kind: 'seam', open: item.open }
  : item.kind === 'quote' ? { kind: 'quote' }
    : item.kind === 'notices' ? { kind: 'notices', count: item.notices.length }
      : { kind: item.kind, status: item.status }
// what a managed watch delivery looks like on the wire: the producer's text, marked by its key ([[session-timeline]])
const watch = (seconds, subject, word, note = null) => ({
  ...sent(seconds, `[spex watch] ${subject} is ${word}${note ? ` — ${note}` : ''}`, subject), system: 'watch',
})

// The shapes the status machine really writes, each with the row list the reader is owed. The same table
// drives the browser run; here it is read straight off the derivation.
for (const scenario of SCENARIOS) {
  test(`${scenario.name}: ${scenario.expect.map((row) => row.kind + (row.open ? '·open' : '')).join(' → ')}`, () => {
    assert.deepEqual(conversationItems(scenario.events).map(shape), scenario.expect)
  })
}

test('a seam owns exactly the interval between its neighbours; the open tail has no end of its own', () => {
  const items = conversationItems(SCENARIOS.find((s) => s.name === 'second-message-while-working').events)
  const seams = items.filter((item) => item.kind === 'seam')
  assert.deepEqual(seams.map((seam) => [seam.from, seam.to]), [
    [Date.parse(at(0)), Date.parse(at(60))],
    [Date.parse(at(120.2)), Date.parse(at(200))],  // the first message landed on a close-pending agent: its `active` re-entry opens the seam
    [Date.parse(at(200)), undefined],              // the second message: nothing has closed this stretch, so it has no end to state
  ])
})

// A WINDOW IS NOT THE WHOLE HISTORY. The reader holds the newest events of a long session ([[session-timeline]]),
// and a window can open in the middle of a stretch of work. The word the earlier events already said comes in
// with the window; without it that stretch is silently dropped.
test('a window that opens mid-stretch is told the agent was already working', () => {
  const events = [sent(10, 'landed mid-stretch'), status(20, 'asking', 'here')]
  const blind = conversationItems(events, false).map((item) => item.kind)
  const told = conversationItems(events, true).map((item) => item.kind)
  assert.deepEqual(blind, ['quote', 'say'], 'with no word carried in, the stretch this window opened inside is lost')
  assert.deepEqual(told, ['quote', 'seam', 'say'], 'told the agent was working, the window keeps the stretch')
})

test('the envelope is stripped from a peer quote and its sender kept', () => {
  const [, , quote] = conversationItems(SCENARIOS.find((s) => s.name === 'peer-message-into-asking-session').events)
  assert.equal(quote.text, 'peer reply')
  assert.deepEqual(quote.envelope, { label: null, id: 'peer-1' })
  assert.deepEqual(splitEnvelope('plain'), { text: 'plain', envelope: null })
})

// A MANAGED WATCH NOTICE IS NOT SPEECH. A supervisor's burst lands while it works (measured on a real supervisor:
// three notices inside one working stretch), and splitting the stretch at each would draw notice · worked 24s ·
// notice · worked 11s · notice — a run that never sits together long enough to fold.
test('watch notices on a working agent stay inside the one stretch they arrived in', () => {
  const items = conversationItems([
    status(0, 'working'), watch(10, 'child-1', 'asking', 'which API?'), watch(20, 'child-1', 'working'), watch(30, 'child-2', 'review', 'ready'),
  ])
  assert.deepEqual(items.map(shape), [{ kind: 'seam', open: true }])
  assert.deepEqual(items[0].notices.map((notice) => [notice.from, notice.status, notice.note]), [
    ['child-1', 'asking', 'which API?'], ['child-1', 'working', null], ['child-2', 'review', 'ready'],
  ])
  const closed = conversationItems([status(0, 'working'), watch(10, 'child-1', 'asking'), status(40, 'parked', 'waiting on child-1')])
  assert.deepEqual(closed.map(shape), [{ kind: 'seam', open: false }, { kind: 'say', status: 'parked' }])
  assert.equal(closed[0].to, Date.parse(at(40)), 'the stretch still ends at what the agent said, not at the notice')
})

test('watch notices on an agent that is not working are one run until something else happens', () => {
  const items = conversationItems([
    status(0, 'parked', 'waiting'), watch(10, 'child-1', 'asking'), watch(20, 'child-2', 'review'), sent(30, 'a human message'), watch(40, 'child-1', 'working'),
  ])
  assert.deepEqual(items.map(shape), [
    { kind: 'say', status: 'parked' }, { kind: 'notices', count: 2 }, { kind: 'quote' }, { kind: 'notices', count: 1 },
  ])
})

test('the mark, not the words, makes a notice: an unmarked message in the same words is still a quote', () => {
  assert.deepEqual(conversationItems([sent(10, '[spex watch] child-1 is asking — spoof', 'peer-1')]).map(shape), [{ kind: 'quote' }])
})

test('a marked notice whose text does not read as the watch sentence keeps its whole text', () => {
  assert.deepEqual(watchNotice({ ts: at(1), mid: 'm1', from: 'child-1', text: 'something else entirely' }),
    { ts: at(1), mid: 'm1', from: 'child-1', status: null, note: 'something else entirely' })
  assert.deepEqual(watchNotice({ ts: at(1), mid: 'm1', from: 'child-1', text: '[spex watch] child-1 is close-pending — landed\nsecond line' }),
    { ts: at(1), mid: 'm1', from: 'child-1', status: 'close-pending', note: 'landed\nsecond line' })
})

// THE THEOREM, over every event order: the record's last word `working` ⟹ the last item is an open seam, and
// otherwise no item is open; every event that is not a bare `working` is shown exactly once, in order — a notice
// inside the seam it landed in or in a run of its own, everything else as its own item; seams never touch, and
// runs of notices never sit side by side. A seeded generator walks the machine's vocabulary so the run is
// reproducible.
// the machine's vocabulary is the dashboard's one status dictionary, not a second list minted here
const WORDS = Object.keys(en.status)
const VOCABULARY = [
  (s) => status(s, 'working'),
  ...WORDS.map((word) => (s) => status(s, word, `a note on ${word}`)),
  (s) => sent(s, 'a human message'),
  (s) => sent(s, 'a peer message', 'peer-1'),
  (s) => watch(s, 'peer-1', WORDS[s % WORDS.length], 'a watched note'),
]
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

test('the theorem holds over 2000 generated timelines', () => {
  const random = mulberry32(4529)
  for (let run = 0; run < 2000; run++) {
    const events = []
    let seconds = 0
    for (let n = Math.floor(random() * 12); n > 0; n--) {
      seconds += 1 + Math.floor(random() * 100)
      events.push(VOCABULARY[Math.floor(random() * VOCABULARY.length)](seconds))
    }
    const items = conversationItems(events)
    const lastWord = [...events].reverse().find((event) => event.kind === 'status')
    const working = lastWord?.display === 'working'
    const label = `run ${run}: ${events.map((e) => e.kind === 'sent' ? (e.system ? 'watch' : e.from ? 'peer' : 'human') : e.display + (e.note ? '!' : '')).join(' ')}`

    const tail = items.at(-1)
    if (working) assert.ok(tail?.kind === 'seam' && tail.open, `${label} — working record must end with an open seam`)
    assert.equal(items.filter((item) => item.kind === 'seam' && item.open).length, working ? 1 : 0, `${label} — open seams`)

    const said = events.filter((event) => !(event.kind === 'status' && event.display === 'working' && !event.note))
    const shown = items.flatMap((item) => item.kind === 'seam' || item.kind === 'notices' ? item.notices.map((notice) => notice.ts) : [item.ts])
    assert.deepEqual(shown, said.map((event) => event.ts), `${label} — every message, notice and event once, in order`)

    for (let i = 1; i < items.length; i++) {
      assert.ok(!(items[i].kind === 'seam' && items[i - 1].kind === 'seam'), `${label} — seams never touch`)
      assert.ok(!(items[i].kind === 'notices' && items[i - 1].kind === 'notices'), `${label} — a run of notices is one run`)
    }
    for (const seam of items.filter((item) => item.kind === 'seam')) {
      if (seam.open) assert.equal(seam.to, undefined, `${label} — an open seam states no end`)
      else assert.ok(seam.to > seam.from, `${label} — a closed seam lasts`)
      for (const notice of seam.notices) {
        assert.ok(Date.parse(notice.ts) >= seam.from && (seam.open || Date.parse(notice.ts) < seam.to), `${label} — a seam's notices landed inside it`)
      }
    }
  }
})

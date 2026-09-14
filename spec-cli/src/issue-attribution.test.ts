import test from 'node:test'
import assert from 'node:assert/strict'
import { attributionNudge } from './issue-attribution.js'

// [[issue-binding]]: the read side drops an unqualified declaration from a session carrying several issues, so the
// write side says so. One issue, or a note naming one of them, is silent — an advisory that fires when it is wrong
// to fire is worse than none, because an agent learns to skip it.
test('a session with one issue, or a note naming one of its own, is told nothing', () => {
  assert.equal(attributionNudge([], 'anything'), '')
  assert.equal(attributionNudge(['local#a'], null), '')
  assert.equal(attributionNudge(['local#a', 'local#b'], 'fixed the fold count [[issue:local#b]]'), '')
})

test('an unattributable declaration is told what it cost, and what to write instead', () => {
  const text = attributionNudge(['local#a', 'local#b'], 'fixed the fold count')
  assert.match(text, /carries 2: local#a, local#b/)
  assert.match(text, /appears on NONE/)
  assert.match(text, /\[\[issue:local#a\]\]/, 'the example names one of the session\'s own issues')
  assert.equal(attributionNudge(['local#a', 'local#b'], null), attributionNudge(['local#a', 'local#b'], ''))
})

test('a note naming an issue the session does not carry is named as the stray it is', () => {
  const text = attributionNudge(['local#a', 'local#b'], 'about [[issue:local#c]]')
  assert.match(text, /names \[\[issue:local#c\]\], which is not one of them/)
})

test('a quoted reference is inert here too, because the ledger reads it the same way', () => {
  assert.match(attributionNudge(['local#a', 'local#b'], 'see `[[issue:local#a]]`'), /appears on NONE/)
})

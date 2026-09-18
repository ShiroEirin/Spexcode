import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeProject } from './project-store.js'

// A project's path becomes ONE directory name under ~/.spexcode/projects, so every character that cannot
// live in a path segment has to be replaced. POSIX needs `/` and `.`; Windows needs two more, and missing
// them was not cosmetic: an absolute Windows path opens with a drive letter, its COLON survived into the
// name, and `mkdir …/projects/C:-Users-…` fails because `:` is illegal in a Windows filename — which took
// out `spex spec lint` and `spex graph --public --html` on every Windows machine.
test('a project directory name carries no character a path segment forbids', () => {
  const illegalOnWindows = /[\\/:*?"<>|]/
  assert.equal(illegalOnWindows.test(encodeProject('C:\\Users\\Jeffry\\atlas-win-demo')), false,
    'a Windows absolute path encodes to a legal filename')
  // The drive letter's colon and the separator after it each become a dash, so the name opens `C--`.
  assert.equal(encodeProject('C:\\Users\\Jeffry\\atlas-win-demo'), 'C--Users-Jeffry-atlas-win-demo')
})

test('a POSIX store keeps the exact name it already had', () => {
  // `:` and `\` never occur in a POSIX absolute path, so widening the class moved no existing directory.
  assert.equal(encodeProject('/home/jeffry/spexcode'), '-home-jeffry-spexcode')
  assert.equal(encodeProject('/Users/jeffryglm/Codebase/temp/z-code'), '-Users-jeffryglm-Codebase-temp-z-code')
  assert.equal(encodeProject('/home/a/b.c/d'), '-home-a-b-c-d')
})

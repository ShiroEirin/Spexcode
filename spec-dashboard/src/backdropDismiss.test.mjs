import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const seam = read('./backdropDismiss.js')
const modal = read('./Modal.jsx')
const search = read('./SpecSearch.jsx')
const node = read('./NodeView.jsx')
const evidence = read('./Evidence.jsx')
const session = read('./SessionInterface.jsx')

test('the shared backdrop seam remembers the press origin before dismissing', () => {
  assert.match(seam, /startedOnBackdrop = useRef\(false\)/)
  assert.match(seam, /onPointerDownCapture: rememberOrigin/)
  assert.match(seam, /onMouseDownCapture: rememberOrigin/)
  assert.match(seam, /if \(!started \|\| !isBackdropTarget\(event\)\) return/)
  assert.match(seam, /onPointerCancel: cancel/)
})

test('outside-close overlays all use the shared gesture boundary', () => {
  for (const [name, source] of [['Modal', modal], ['search palette', search], ['node popup', node], ['image lightbox', evidence], ['session overlays', session]]) {
    assert.match(source, /useBackdropDismiss/, `${name} uses the shared backdrop seam`)
    assert.doesNotMatch(source, /(?:legend-backdrop|search-backdrop|ov-backdrop|lightbox|si-archive-backdrop|si-launcher-backdrop)[^\n]*on(?:Click|MouseDown)=/, `${name} has no raw backdrop close handler`)
  }
})

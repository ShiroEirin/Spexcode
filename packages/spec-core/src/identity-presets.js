// One browser-safe identity registry shared by backend validation and every dashboard projection.
// Geometry is data so the React renderer and favicon serializer cannot drift into separate drawings.
//
// @@@ shape keys travel through two renderers - a shape's own attributes override the group's
// fill/stroke, which is how a multi-colour mark fits a single-fg registry. Both consumers pass the keys
// through verbatim: the string serializer spreads them as attributes, React spreads them as JSX props.
// So a key must be valid in BOTH, which rules out hyphenated names (React wants strokeWidth) - hence a
// painted seam outline rather than a stroked line, since per-shape stroke-width cannot be expressed.

export const DEFAULT_PROJECT_ICON = 'spexcode'
export const DEFAULT_GATEWAY_ICON = 'gateway'

export const IDENTITY_PRESETS = Object.freeze([
  {
    // The brand mark (docs/brand, 2026-09): a tile cut by one steep diagonal seam — cream upper-left carrying a
    // black brush "<", near-black lower-right carrying an electric-cyan pixel ">". The seam runs (15.5,1)→(9.5,23)
    // so both glyphs stay on their own ground; the black region follows the tile's own rounded corners so it
    // never pokes outside the rect. Painted rather than stroked — see the paint note above. The chevron is a
    // flat polygon standing in for the brush stroke; the ">" is five 2.5-unit blocks, one block thick, which is
    // exactly what the 16px favicon resolves to as well.
    id: 'spexcode', label: 'SpexCode', bg: '#F3ECDE', fg: '#0E0E10',
    shapes: [
      { tag: 'path', d: 'M 15.5,1 H 18 A 5 5 0 0 1 23 6 V 18 A 5 5 0 0 1 18 23 H 9.5 Z', fill: '#0E0E10', stroke: 'none' },
      { tag: 'path', d: 'M 10.5,5.5 L 4,12 L 10.5,18.5 L 10.5,15.5 L 7,12 L 10.5,8.5 Z', fill: '#0E0E10', stroke: 'none' },
      { tag: 'rect', x: 14.5, y: 5.75, width: 2.5, height: 2.5, fill: '#17E6F0', stroke: 'none' },
      { tag: 'rect', x: 17, y: 8.25, width: 2.5, height: 2.5, fill: '#17E6F0', stroke: 'none' },
      { tag: 'rect', x: 19.5, y: 10.75, width: 2.5, height: 2.5, fill: '#17E6F0', stroke: 'none' },
      { tag: 'rect', x: 17, y: 13.25, width: 2.5, height: 2.5, fill: '#17E6F0', stroke: 'none' },
      { tag: 'rect', x: 14.5, y: 15.75, width: 2.5, height: 2.5, fill: '#17E6F0', stroke: 'none' },
    ],
  },
  {
    id: 'gateway', label: 'Gateway', bg: '#155e75', fg: '#ecfeff',
    shapes: [
      { tag: 'path', d: 'm12 3 8 4.2-8 4.2-8-4.2Z' },
      { tag: 'path', d: 'm4 11.2 8 4.2 8-4.2' },
      { tag: 'path', d: 'm4 15.2 8 4.2 8-4.2' },
    ],
  },
  {
    id: 'mdi:rocket-launch', label: 'Rocket', bg: '#9f1239', fg: '#fff1f2',
    shapes: [
      { tag: 'path', d: 'M14.5 5.2c2.2-2.2 4.8-2 5.3-1.8.2.5.4 3.1-1.8 5.3l-5.5 5.5-4.2-4.2Z' },
      { tag: 'path', d: 'm11.2 6.8-4.1.6-2.5 2.5 4.1.7' },
      { tag: 'path', d: 'm16.4 12-1 4.7-2.5 2.5-.7-4.1' },
      { tag: 'circle', cx: 16.1, cy: 7.1, r: 1.2 },
      { tag: 'path', d: 'M7.6 14.6c-2.2.4-3.4 1.6-3.6 3.8 2.2-.2 3.4-1.4 3.8-3.6' },
    ],
  },
  {
    id: 'compass', label: 'Compass', bg: '#1d4ed8', fg: '#eff6ff',
    shapes: [
      { tag: 'circle', cx: 12, cy: 12, r: 8.5 },
      { tag: 'path', d: 'm15.2 8.8-1.8 4.6-4.6 1.8 1.8-4.6Z' },
    ],
  },
  {
    id: 'terminal', label: 'Terminal', bg: '#3f3f46', fg: '#fafafa',
    shapes: [
      { tag: 'rect', x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 },
      { tag: 'path', d: 'm7 9 3 3-3 3' },
      { tag: 'path', d: 'M12.5 15H17' },
    ],
  },
  {
    id: 'package', label: 'Package', bg: '#6d28d9', fg: '#f5f3ff',
    shapes: [
      { tag: 'path', d: 'm12 3 8 4.5v9L12 21l-8-4.5v-9Z' },
      { tag: 'path', d: 'm4.3 7.7 7.7 4.4 7.7-4.4' },
      { tag: 'path', d: 'M12 12.1V21' },
    ],
  },
  {
    id: 'database', label: 'Database', bg: '#a16207', fg: '#fefce8',
    shapes: [
      { tag: 'ellipse', cx: 12, cy: 6, rx: 7.5, ry: 3 },
      { tag: 'path', d: 'M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6' },
      { tag: 'path', d: 'M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6' },
    ],
  },
  {
    id: 'spark', label: 'Spark', bg: '#c2410c', fg: '#fff7ed',
    shapes: [
      { tag: 'path', d: 'm12 3 1.5 5.2L19 10l-5.5 1.8L12 17l-1.5-5.2L5 10l5.5-1.8Z' },
      { tag: 'path', d: 'm18.5 15 .7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8Z' },
    ],
  },
])

const BY_ID = new Map(IDENTITY_PRESETS.map((preset) => [preset.id, preset]))
const ICONIFY_ID = /^[a-z0-9-]+[:/][a-z0-9-]+$/i
const ALIASES = new Map([
  ['rocket', 'mdi:rocket-launch'],
  ['mdi/rocket-launch', 'mdi:rocket-launch'],
  ['layers', 'gateway'],
  ['default', 'spexcode'],
])

export const IDENTITY_PRESET_IDS = Object.freeze(IDENTITY_PRESETS.map((preset) => preset.id))

export function resolvedIdentityIcon(value, fallback = DEFAULT_PROJECT_ICON) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const id = ALIASES.get(raw) || raw
  return id || fallback
}

export function identityPreset(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return BY_ID.get(ALIASES.get(raw) || raw) || null
}

export function isIconifyIcon(value) {
  return ICONIFY_ID.test(typeof value === 'string' ? value.trim() : '')
}

export function requireIdentityChoice(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const id = ALIASES.get(raw) || raw
  if (BY_ID.has(id)) return id
  if (isIconifyIcon(id)) return id.replace('/', ':')
  throw new Error(`unknown identity icon '${raw}' (choose a preset or Iconify prefix:name)`)
}

function attrs(shape) {
  return Object.entries(shape).filter(([key]) => key !== 'tag')
    .map(([key, value]) => `${key === 'className' ? 'class' : key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')
}

export function identitySvg(value, fallback = DEFAULT_PROJECT_ICON) {
  const preset = identityPreset(value) || identityPreset(fallback)
  const geometry = preset.shapes.map((shape) => `<${shape.tag} ${attrs(shape)}/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="5" fill="${preset.bg}"/><g fill="none" stroke="${preset.fg}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${geometry}</g></svg>`
}

export function identityFaviconHref(value, fallback = DEFAULT_PROJECT_ICON) {
  const resolved = resolvedIdentityIcon(value, fallback)
  if (identityPreset(resolved)) return `data:image/svg+xml,${encodeURIComponent(identitySvg(resolved, fallback))}`
  if (/^https?:\/\//.test(resolved)) return resolved
  if (isIconifyIcon(resolved)) return `https://api.iconify.design/${resolved.replace(':', '/')}.svg`
  const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y=".86em" font-size="82" text-anchor="middle">${resolved.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(glyph)}`
}

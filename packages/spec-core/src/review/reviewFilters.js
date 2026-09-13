import { FLEET_STATES, fleetWorkState, issueFleet, sessionPresent } from './session.js'
import { effectiveTokens, tokenize } from './reviewQuery.js'

// [[review-filters]]: one pure filter engine — the single home of Issues FIELD SEMANTICS. The domain
// adapter below provides field values; surfaces provide only the state home and presentation: the
// canonical page parses its ONE visible token text ([[review-query]]) and bridges it here, the Spec
// Information panes keep plain local state. Neither duplicates matching.

const text = (value) => String(value ?? '').trim().toLocaleLowerCase()
const values = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])
const unique = (items) => [...new Set(items.flatMap(values).filter((value) => value != null && value !== '').map(String))]

const optionLabel = (t, key, fallback) => t ? t(key) : fallback
const allOption = (t) => ({ value: '', label: optionLabel(t, 'reviewList.all', 'All') })
const optionsFor = (items, facet, state, context, t) => {
  const active = state[facet.key] != null && String(state[facet.key]) !== ''
  // a fixed-value ENUM facet keeps its ACTIVE value as a real (checked) row even when no data carries
  // it — an active facet must never hide its own off-switch; data-valued facets stay data-derived.
  const found = facet.fixedValues
    ? facet.fixedValues.filter((value) => (active && String(state[facet.key]) === String(value))
      || items.some((item) => values(facet.values(item, context)).map(String).includes(String(value))))
    : unique(items.map((item) => facet.values(item, context)))
  if (found.length < (facet.minValues ?? 2) && !active) return []
  return [allOption(t), ...found.map((value) => ({
    value,
    label: facet.labelValue ? facet.labelValue(value, context) : value,
  }))]
}

export function filterReviewItems(items, state, config, context = {}) {
  // `q` is one substring or an ARRAY of substrings (the token text's bare words/phrases), conjunctive;
  // an `impossible` state (an unknown qualifier in the canonical text) honestly matches NOTHING.
  const qs = values(state.q).map(text).filter(Boolean)
  const faceted = state.impossible ? [] : items.filter((item) => (
    qs.every((q) => config.search(item, context).some((value) => text(value).includes(q)))
    && config.facets.every((facet) => {
      const selected = state[facet.key]
      if (selected == null || selected === '') return true
      return facet.matches
        ? facet.matches(item, selected, context)
        : values(facet.values(item, context)).map(String).includes(String(selected))
    })
  ))
  // a domain may ARRANGE the matched rows — which of them stand as rows, in what order — after matching and before
  // counting, so a section count is always the number of rows that section shows.
  const arrange = (rows) => (config.arrange ? config.arrange(rows, state, context) : rows)
  const sectionValue = config.section && state[config.section.key]
  const sectionMatch = (item, selected) => (config.section.matches
    ? config.section.matches(item, selected, context)
    : String(config.section.value(item, context)) === String(selected))
  const shown = arrange(sectionValue == null || sectionValue === ''
    ? faceted
    : faceted.filter((item) => sectionMatch(item, sectionValue)))
  // a section count is ONE number: the section's shown rows under the REST of the query.
  const sections = config.section
    ? Object.fromEntries(config.section.options.map((option) => [option.value, arrange(faceted.filter((item) => sectionMatch(item, option.value))).length]))
    : {}
  const facets = Object.fromEntries(config.facets.map((facet) => [facet.key, {
    key: facet.key,
    label: optionLabel(context.t, facet.label, facet.key),
    value: state[facet.key] || '',
    options: optionsFor(items, facet, state, context, context.t),
  }]))
  return { state, faceted, shown, sections, facets }
}

export const reviewActorName = (actor) => String(actor || '').length > 22 ? `${String(actor).slice(0, 8)}…` : actor
// the source-session PRESENCE join ([[live-session-filter]]): originator or any reply author still
// resolves on the board — membership, never liveness.
const issuePresent = (issue, sessions) => !!sessionPresent(sessions, issue.by)
  || (Array.isArray(issue.replies) && issue.replies.some((reply) => sessionPresent(sessions, reply.by)))
// the FLEET facet ([[issue-binding]]): the issue's rolled-up work state over the sessions bound to it — the same
// join the Issues page draws its strip from, so `fleet:need` lists exactly the rows whose strip reads "needs you".
const fleetFacet = () => ({
  key: 'fleet', label: 'reviewList.facetFleet', fixedValues: FLEET_STATES,
  values: (issue, { sessions }) => fleetWorkState(issueFleet(issue, sessions).fleet),
  labelValue: (value, { t }) => optionLabel(t, `reviewList.fleet${value[0].toUpperCase()}${value.slice(1)}`, value),
})
const presenceFacet = (valuesOf) => ({
  key: 'session', label: 'reviewList.facetSession', fixedValues: ['present', 'missing'],
  values: valuesOf,
  labelValue: (value, { t }) => optionLabel(t, value === 'present' ? 'reviewList.sessionPresent' : 'reviewList.sessionMissing', value),
})

// @@@ issue tree - the two DISPLAY dimensions of the sub-issue tree ([[issues-view]]): they select no row by a field,
// they arrange the matched ones. A sub-issue is NESTED when its parent also matched. `sub:top` (the default) folds a
// nested sub-issue into its parent's row; one whose parent this view does not match (another state, another node, a
// search) still stands as its own row, so no view hides an issue it matched. `sub:all` lists every match flat.
// `group:parent` draws the matched set as the tree: each nested issue follows its parent, carrying its `depth`. A walk
// starts only at a row that is not nested, so pointers that loop among nested rows can never spin it.
export function arrangeIssueTree(rows, { sub = '', group = '' } = {}) {
  const matched = new Set(rows.map((issue) => issue.id))
  const nested = (issue) => !!issue.parent && matched.has(issue.parent)
  if (group !== 'parent') return sub === 'all' ? rows : rows.filter((issue) => !nested(issue))
  const kids = new Map()
  for (const issue of rows) if (nested(issue)) kids.set(issue.parent, [...(kids.get(issue.parent) || []), issue])
  const out = []
  const walk = (issue, depth) => {
    out.push(depth ? { ...issue, depth } : issue)
    for (const kid of kids.get(issue.id) || []) walk(kid, depth + 1)
  }
  for (const issue of rows) if (!nested(issue)) walk(issue, 0)
  return out
}
// offered only while the data holds a tree to arrange; it never filters a row itself.
const treeFacet = (key, value) => ({
  key, label: `reviewList.facet${key[0].toUpperCase()}${key.slice(1)}`, fixedValues: [value], minValues: 1,
  values: (issue) => (issue.parent ? value : null),
  matches: () => true,
})

export function issueFilterState(raw = {}, { defaultSection = '' } = {}) {
  const state = raw.state === 'closed' || raw.concluded === '1'
    ? 'closed'
    : raw.state || defaultSection
  return {
    q: raw.q || '', state, impossible: raw.impossible === true,
    author: raw.author || '', store: raw.store || '', node: raw.node || '', label: raw.label || '',
    session: raw.session || '',
    fleet: raw.fleet || '',
    sub: raw.sub || '',
    group: raw.group || '',
  }
}

const ISSUE_CONFIG = {
  search: (issue) => [issue.id, issue.concern, issue.by, ...(issue.nodes || [])],
  section: {
    key: 'state',
    value: (issue) => issue.status === 'open' ? 'open' : 'closed',
    // open|closed are the lifecycle halves; a concrete concluded spelling (landed) matches that status
    // honestly instead of pretending the enum is binary.
    matches: (issue, selected) => (selected === 'open' ? issue.status === 'open'
      : selected === 'closed' ? issue.status !== 'open' : issue.status === selected),
    options: [{ value: 'open', label: 'reviewList.open' }, { value: 'closed', label: 'reviewList.closed' }],
  },
  facets: [
    { key: 'author', label: 'reviewList.facetAuthor', values: (issue) => issue.by, labelValue: reviewActorName },
    { key: 'store', label: 'reviewList.facetStore', values: (issue) => issue.store },
    { key: 'node', label: 'reviewList.facetNode', values: (issue) => issue.nodes || [] },
    { key: 'label', label: 'reviewList.facetLabel', values: (issue) => (issue.labels || []).map((label) => typeof label === 'string' ? label : label?.name), minValues: 1 },
    presenceFacet((issue, { sessions }) => issuePresent(issue, sessions) ? 'present' : 'missing'),
    fleetFacet(),
    treeFacet('sub', 'all'),
    treeFacet('group', 'parent'),
  ],
  arrange: (rows, state) => arrangeIssueTree(rows, state),
}

export function issueFilterModel(items, raw = {}, context = {}) {
  const state = issueFilterState(raw, { defaultSection: context.defaultSection ?? '' })
  const model = filterReviewItems(items, state, ISSUE_CONFIG, context)
  model.section = {
    key: 'state', label: optionLabel(context.t, 'reviewList.facetState', 'State'), value: state.state,
    meaningful: Object.values(model.sections).filter((count) => count > 0).length > 1 || !!state.state,
    options: [allOption(context.t), ...ISSUE_CONFIG.section.options.map((option) => ({
      value: option.value,
      label: optionLabel(context.t, option.label, option.value),
      count: model.sections[option.value],
    }))].filter((option, index) => index === 0 || option.count > 0 || option.value === state.state),
  }
  return model
}

export function filterMenuGroups(model, onChange, keys) {
  return keys.map((key) => key === 'section' ? model.section : model.facets[key]).filter((facet) => (
    facet?.meaningful !== false
    && (facet?.options?.length > 1 || (facet?.value != null && facet.value !== '' && facet.value !== 'all'))
  )).map((facet) => ({
    key: facet.key,
    label: facet.label,
    value: facet.value,
    active: facet.value != null && facet.value !== '' && facet.value !== 'all',
    options: facet.options,
    clearLabel: facet.value === 'all' ? null : undefined,
    onChange: (value) => onChange({ [facet.key]: value || null }),
  }))
}

// the CANONICAL page's bridge ([[review-query]] → this engine): parse the ONE visible token text into
// engine state. Bare words/phrases become conjunctive q substrings; duplicate qualifiers are last-wins;
// a qualifier outside the page's map (or a wrong is: identity) marks the state IMPOSSIBLE — the token
// stays verbatim in the text and the list honestly shows nothing. One map per domain: adding a domain
// is adding its map here, never a second parser.
const TOKEN_MAPS = {
  issue: {
    is: (v) => (v === 'issue' ? {} : null),
    state: (v) => ({ state: v }),
    store: (v) => ({ store: v }),
    author: (v) => ({ author: v }),
    node: (v) => ({ node: v }),
    label: (v) => ({ label: v }),
    session: (v) => ({ session: v }),
    fleet: (v) => ({ fleet: v }),
    // the defaults have spellings too, so a hand-typed `sub:top` or `group:none` is the default view, not a zero
    sub: (v) => (v === 'all' ? { sub: 'all' } : v === 'top' ? { sub: '' } : null),
    group: (v) => (v === 'parent' ? { group: 'parent' } : v === 'none' ? { group: '' } : null),
  },
}

export function tokenFilterState(text, domain) {
  const map = TOKEN_MAPS[domain]
  const state = { q: [] }
  for (const token of effectiveTokens(tokenize(text))) {
    if (token.key == null) { state.q.push(token.value); continue }
    const toState = map[token.key]
    const mapped = toState ? toState(token.value) : null
    if (mapped == null) return { impossible: true, q: [] }
    Object.assign(state, mapped)
  }
  return state
}

import { useEffect, useMemo, useState } from 'react'
import { apiUrl } from './project.js'
import { useT } from './i18n/index.jsx'
import { Segmented } from './Segmented.jsx'
import { useResizable } from './useResizable.js'

// THE AUTOMATION, AS A PLACE YOU WORK RATHER THAN A PAGE YOU READ. Every plugin here is already a spec node
// and already in the graph, so this board is not about making them exist on screen — it is about reading
// them by the surface they plug into instead of the folder they sit in, and about seeing what one of them
// actually DOES without leaving.
//
// @@@a-board-is-a-frame-not-a-document - the first two versions were one column in the shared page
// scrollport: three stacked sections, one scrollbar, every row a link that navigated away. That is the
// shape of a settings page — something you visit once a quarter, read top to bottom, and leave — and it is
// the wrong shape for the thing a project's automation is. A surface you MANAGE holds still while you work
// it: the frame and its controls never move, the list and the detail scroll independently, and selecting a
// row answers the question in place instead of spending the whole window to go and look. So the page root
// is a bounded pane ([[page-scroll]] exempts these deliberately) and the split is the one
// [[diff-document]] already establishes — resizable master list, pinned zone headings, detail pane owning
// its own overflow.
//
// The LIFECYCLE SPINE survives the change of shape and gets better from it: the seven events are the list's
// sticky group headings now, so the event a hook runs on stays overhead while its siblings scroll under it,
// instead of being a label you have already scrolled past.
//
// @@@normal-is-not-drawable - a marker for the ORDINARY case must be unrepresentable, or nothing stands out
// because everything is marked. An earlier version put order, refusal and a file count on every row and
// read as a badge farm. So `Mark` returns null unless the thing it names is true, and `order` is drawn only
// on an event carrying more than one hook — the only place the number decides anything, since elsewhere
// position already says it.

const specHref = (name) => `#/spec/${encodeURIComponent(name)}`
const SURFACE_FILTERS = ['all', 'hook', 'system', 'invoked']

// a mark exists only when it is TRUE; there is no neutral variant to render by accident
const Mark = ({ when, glyph, tone, tip }) => (when
  ? <span className={`pg-mark pg-${tone}`} data-tip={tip} aria-label={tip}>{glyph}</span>
  : null)

function Row({ row, selected, onSelect, mark = null, meta = null, dim = false }) {
  const on = selected === row.name
  return (
    <button type="button"
      className={`ft-row pg-item${on ? ' on' : ''}${dim ? ' is-dim' : ''}`}
      aria-current={on ? 'true' : undefined}
      data-tip={row.desc || undefined}
      onClick={() => onSelect(row.name)}>
      <span className="pg-rail">{mark}</span>
      <span className="ft-label">{row.name}</span>
      {meta}
    </button>
  )
}

// The detail is the one thing the old page could not do: say what the plugin DOES. Its text is fetched per
// selection ([[plugins-view]]), so this pane owns a small load of its own and says so rather than blanking.
function Detail({ name, row, t }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!name) return undefined
    let live = true
    setDetail(null)
    setError(null)
    fetch(apiUrl(`/api/plugins/surfaces/${encodeURIComponent(name)}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (live) setDetail(data) })
      .catch((err) => { if (live) setError(err.message || String(err)) })
    return () => { live = false }
  }, [name])

  if (!name) return <div className="pg-detail pg-detail-empty">{t('plugins.pickOne')}</div>

  return (
    <div className="pg-detail">
      <header className="pg-detail-head">
        <h2 className="pg-detail-name">{name}</h2>
        <span className="pg-detail-surfaces">{(row?.surfaces || []).join(' · ')}</span>
        <a className="pg-detail-node" href={specHref(name)}>{t('plugins.openNode')}</a>
      </header>
      {row?.desc && <p className="pg-detail-desc">{row.desc}</p>}
      <dl className="pg-facts">
        {row?.events?.length > 0 && <><dt>{t('plugins.factEvents')}</dt><dd>{row.events.join(', ')}</dd></>}
        {row?.surfaces?.includes('hook') && <><dt>{t('plugins.factOrder')}</dt><dd>{row.order}</dd></>}
        {row?.surfaces?.includes('hook') && <><dt>{t('plugins.factBlock')}</dt>
          <dd>{t(row.block ? 'plugins.factBlockYes' : 'plugins.factBlockNo')}</dd></>}
        {detail?.tools?.length > 0 && <><dt>{t('plugins.factTools')}</dt><dd>{detail.tools.join(', ')}</dd></>}
      </dl>
      <div className="pg-detail-body">
        {error && <p className="pg-error">{t('plugins.failed', { reason: error })}</p>}
        {!error && !detail && <p className="pg-detail-wait">{t('plugins.reading')}</p>}
        {detail && <>
          <pre className="pg-text pg-prose">{detail.body}</pre>
          {detail.files.map((file) => (
            <section className="pg-file" key={file.path}>
              <h3 className="pg-file-name">{file.path.split('/').pop()}
                <span className="pg-file-path">{file.path}</span>
              </h3>
              <pre className="pg-text">{file.text}</pre>
              {file.truncated && <p className="pg-file-cut">{t('plugins.truncated', { bytes: file.bytes })}</p>}
            </section>
          ))}
        </>}
      </div>
    </div>
  )
}

export default function PluginsView() {
  const t = useT()
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [surface, setSurface] = useState('all')
  const [width, onDragStart, resetWidth] = useResizable('spex.pluginsPanelWidth', 300, { min: 220, max: 560 })

  useEffect(() => {
    let live = true
    fetch(apiUrl('/api/plugins/surfaces'))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (live) setView(data) })
      .catch((err) => { if (live) setError(err.message || String(err)) })
    return () => { live = false }
  }, [])

  const byName = useMemo(() => new Map((view?.rows || []).map((row) => [row.name, row])), [view])

  // One predicate for both panes: the filter decides what the list SHOWS, never what the inventory IS
  // ([[plugins-view]] always answers whole), and the counts in the bar report the filtered view honestly.
  const keep = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (row) => {
      if (!row) return false
      if (surface === 'invoked' ? !row.surfaces.some((s) => s === 'skill' || s === 'command')
        : surface !== 'all' && !row.surfaces.includes(surface)) return false
      if (!needle) return true
      return row.name.toLowerCase().includes(needle) || (row.desc || '').toLowerCase().includes(needle)
    }
  }, [query, surface])

  if (error) return <div className="pg-board"><p className="pg-error">{t('plugins.failed', { reason: error })}</p></div>
  if (!view) return <div className="pg-board" />

  const { rows, spine, profile } = view
  const shown = rows.filter(keep)
  const system = shown.filter((row) => row.surfaces.includes('system'))
  const invoked = shown.filter((row) => row.surfaces.includes('skill') || row.surfaces.includes('command'))
  const spineShown = spine
    .map((slot) => ({ ...slot, hooks: slot.hooks.filter((hook) => keep(byName.get(hook.name))) }))
    .filter((slot) => slot.hooks.length > 0)

  const zone = (key, count, label) => (
    <div className="si-zone pg-zone" role="heading" aria-level="2" key={`z:${key}`}>
      <span className="si-zone-count" aria-hidden="true">{count}</span>
      <span className="si-zone-label">{label}</span>
    </div>
  )

  return (
    <div className="pg-board">
      {/* The bar carries what the reader acts WITH — never what the tab strip already says. */}
      <header className="pg-bar">
        <span className="pg-count">{t('plugins.count', { shown: shown.length, total: rows.length })}</span>
        <input className="pg-search" type="search" value={query} placeholder={t('plugins.searchHint')}
          aria-label={t('plugins.searchHint')} onChange={(e) => setQuery(e.target.value)} />
        <Segmented label={t('plugins.surfaceFilter')} value={surface} onPick={setSurface}
          options={SURFACE_FILTERS.map((value) => ({ value, label: t(`plugins.filter.${value}`) }))} />
        <span className="pg-profile">
          <span className="pg-profile-k">{t('plugins.profileLabel')}</span>
          <code>{profile.name}</code>
          {profile.disables.length === 0
            ? t('plugins.profileAll', { n: profile.retains.length })
            : t('plugins.profileSome', { kept: profile.retains.length, off: profile.disables.join(', ') })}
        </span>
      </header>

      <div className="pg-split" style={{ '--pg-panel': `${width}px` }}>
        <nav className="pg-list" aria-label={t('plugins.listLabel')}>
          {/* the spine is the list's group headings now: the event stays overhead while its hooks scroll */}
          {spineShown.map((slot) => (
            <section key={slot.event}>
              {zone(slot.event, slot.hooks.length, slot.event)}
              {slot.hooks.map((hook) => (
                <Row key={`${slot.event}:${hook.name}`} row={byName.get(hook.name) || { name: hook.name, desc: '' }}
                  selected={selected} onSelect={setSelected}
                  dim={profile.disables.includes(hook.name)}
                  mark={<Mark when={hook.block} glyph="⊘" tone="refuse" tip={t('plugins.blocksTip')} />}
                  meta={slot.hooks.length > 1
                    ? <span className="pg-ord" data-tip={t('plugins.orderTip')}>{hook.order}</span>
                    : null} />
              ))}
            </section>
          ))}
          {system.length > 0 && <section>
            {zone('system', system.length, t('plugins.alwaysOn'))}
            {system.map((row) => <Row key={row.name} row={row} selected={selected} onSelect={setSelected} />)}
          </section>}
          {invoked.length > 0 && <section>
            {zone('invoked', invoked.length, t('plugins.invoked'))}
            {invoked.map((row) => {
              const both = row.surfaces.includes('skill') && row.surfaces.includes('command')
              return <Row key={row.name} row={row} selected={selected} onSelect={setSelected}
                meta={<span className={both ? 'pg-surf is-both' : 'pg-surf'}>
                  {both ? t('plugins.bothSurfaces') : row.surfaces.includes('skill') ? 'skill' : 'command'}
                </span>} />
            })}
          </section>}
          {shown.length === 0 && <p className="pg-none">{t('plugins.noMatch')}</p>}
        </nav>
        <div className="pg-resize" onMouseDown={onDragStart} onDoubleClick={resetWidth} aria-hidden="true" />
        <Detail name={selected} row={byName.get(selected)} t={t} />
      </div>
    </div>
  )
}

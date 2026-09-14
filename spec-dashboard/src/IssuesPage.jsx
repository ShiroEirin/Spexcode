import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { loadIssue, loadSessionTimeline, postIssueClose, postIssuePromote, postIssueReply, postIssueThread } from './data.js'
import { ledgerFromChildren, ledgerFromTimeline, ledgerSince } from './issueLedger.js'
import { MENTION_RE, TriggerButton, typeTrigger, useMentionAutocomplete } from './mentions.jsx'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { SpecBody } from './NodeView.jsx'
import { Replies, ReplyComposer, SendToSessionActions } from './Thread.jsx'
import { useWidgetHost } from './widgetHost.js'
import { useT } from './i18n/index.jsx'
import { DetailShell, FacetMenu, ListPage, ReviewListRow, ReviewRows, ReviewState, SecondaryFilters, SideSection, SideValue } from './ReviewShell.jsx'
import { ISSUE_QUERY_DEFAULT, queryParam, readToken, reviewRouteQuery, setToken } from '@spexcode/spec-core/review'
import { reviewActorName } from '@spexcode/spec-core/review'
import { reviewPageNumber, useReviewPage } from './reviewPage.js'
import { useTransientNotice } from './TransientNotice.jsx'
import { routeHash } from './route.js'
import { addressHash, detailBackHash, specAddress } from './address.js'
import { Icon } from './icons.jsx'
import IssueLabels from './IssueLabels.jsx'
import IssueSessions, { FleetStrip, FleetWorkState } from './IssueSessions.jsx'
import { issueFleet, mentionedSessions } from './session.js'
import { useLaunchers } from './launch.js'
import { useReportDocumentName } from './documentActions.jsx'
import { usePaneActive } from './workspace.jsx'
import { useViewScope } from './ViewScope.jsx'

const EMPTY_QUERY = {}

// The Issues surface ([[issues-view]]): GitHub-style pages over ONE route family, all wearing the shared
// [[review-chrome]]. `#/issues` is the LIST page — the merged local+forge list (store-tagged, API
// order, no re-sort), structured rows that are REAL anchors, query/sections/facets in the URL; `#/issues/<id>` is
// the standalone DETAIL page — the markdown body + reply thread as the main column with the composer
// docked at its foot, the status/store/originator/node metadata in the side rail; `#/issues/new` is the
// standalone COMPOSE page. A row click PUSHES; browser Back restores the exact filtered list; every page is
// directly openable. Writes post as 'human' and route by store ([[issues]]).

// the compose address' one path word ([[issues-view]]): `#/issues/new` is the compose PAGE, never an issue
// detail — the local store reserves the same word at id minting ([[local-issues]]), so no issue can own it.
export const NEW_PARAM = 'new'

const concluded = (i) => i.status !== 'open'

const age = (ts) => {
  const seconds = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

const issueNumber = (id) => {
  const parts = String(id || '').split('#')
  const value = parts.length > 1 ? parts.at(-1) : parts[0]
  return `#${value.length > 16 ? `${value.slice(0, 13)}…` : value}`
}

// the page's recognized qualifier vocabulary — what the highlight overlay colors and the key
// autocomplete offers; anything else stays plain and matches nothing.
export const ISSUE_QUERY_KEYS = ['is', 'state', 'store', 'author', 'node', 'label', 'session', 'fleet', 'sub', 'group']

// The LIST page (`#/issues[?q=<raw tokens>]`) requests one resident-source page from the server; the WHOLE
// face is ONE visible token query ([[review-query]]) bridged into the
// ONE field-semantics engine ([[review-filters]]): sections and low-cardinality menus are pure builders
// doing token surgery + PUSH over the COMMITTED text, author/node are token-only, and the list
// re-derives everything from the URL on every hashchange so Back replays it exactly.
const facetOptions = (data, key, allLabel, labelValue = (value) => value) => (data?.facets?.[key]?.options ?? []).map((option) => ({
  value: option.value,
  label: option.value === '' ? allLabel : labelValue(option.value),
}))

// ONE issue row ([[issues-view]]): the list page and the detail's Sub-issues section draw an issue from the same facts
// through this builder, so a sub-issue there reads exactly as it does in the list. A row the tree nests carries its
// `depth`; a parent row counts its closed sub-issues beside the comment count.
function issueRow(th, { t, sessions = [], stores = [], onLabel = null }) {
  const status = th.status || 'open'
  const closedKids = th.childCounts?.closed ?? 0
  const kids = (th.childCounts?.open ?? 0) + closedKids
  return {
    key: th.id,
    label: th.concern,
    href: routeHash('issues', th.id),
    content: (
      <ReviewListRow
        depth={th.depth || 0}
        state={<ReviewState kind="issue" state={status} />}
        title={<><span className="rl-row-title-text">{th.concern}</span><IssueLabels labels={th.labels} onSelect={onLabel} /></>}
        meta={(
          <>
            <span data-tip={th.id}>{issueNumber(th.id)}</span>
            {th.by && <span data-tip={th.by}>{t('reviewList.openedBy', { by: reviewActorName(th.by) })}</span>}
            {th.created && <span>{t('reviewList.openedAt', { at: age(th.created) })}</span>}
          </>
        )}
        aside={(
          <>
            {/* who is on it ([[issue-binding]]): the fleet strip, joined client-side against the board the page already holds */}
            <FleetStrip fleet={issueFleet(th, sessions).fleet} />
            {kids > 0 && <span className="rl-comments" data-tip={t('session.issuesSubCount', { closed: closedKids, total: kids })}><Icon name="list-checks" size={14} />{closedKids}/{kids}</span>}
            {(th.replies?.length ?? 0) > 0 && <span className="rl-comments" data-tip={t('session.issuesReplies', { n: th.replies.length })}><Icon name="message-square" size={14} />{th.replies.length}</span>}
            {stores.length > 1 && <span className={`rl-tag fv-store-${th.store === 'local' ? 'local' : 'forge'}`}>{th.store}</span>}
            {th.nodes?.[0] && <a className="rl-tag node" href={addressHash(specAddress(th.nodes[0]))}>{th.nodes[0]}</a>}
          </>
        )}
      />
    ),
  }
}

export function IssuesListPage({ data, loading, error, query, onQueryText, sessions = [] }) {
  const t = useT()
  if (data && !data.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>

  const all = Array.isArray(data?.items) ? data.items : []
  const text = String(query.q ?? '').trim() || ISSUE_QUERY_DEFAULT
  // a human's edit/tab/menu action PUSHES the canonical address — bare for the default view, exactly
  // ?q=<raw text> otherwise (GitHub's semantics — Back walks filter history).
  const push = (nextText) => onQueryText?.(nextText)
  const surgery = (key, value) => push(setToken(text, key, value))

  // Store options come from DATA, not a hardcoded list — a new adapter appears without new chrome.
  const stores = (data?.facets?.store?.options ?? []).map((option) => option.value).filter(Boolean)
  const issues = all
  const openCount = data?.counts?.open || 0
  const closedCount = data?.counts?.closed || 0
  const section = readToken(text, 'state')

  // a row leads with the ISSUE (status mark + concern); store/replies are trailing quiet meta —
  // the store mini-tag renders only while stores are actually mixed ([[issues-view]]).
  const rows = issues.map((th) => issueRow(th, { t, sessions, stores, onLabel: (name) => surgery('label', name) }))

  // New is a DOOR to its own page ([[issues-view]]'s compose address), so it is a REAL anchor — a click is
  // the same transaction the address bar produces, and middle-click/new-tab/copy-address come free.
  const newAction = <a className="rl-new" href={routeHash('issues', NEW_PARAM)}><Icon name="plus" size={14} />{t('session.issuesNew')}</a>

  // menus are pure query builders over the ADAPTER's data-derived options — zero private state.
  const storeFacet = { label: t('reviewList.facetStore'), value: readToken(text, 'store'), options: facetOptions(data, 'store', t('reviewList.all')) }
  const sessionFacet = {
    label: t('reviewList.facetSession'), value: readToken(text, 'session'),
    options: facetOptions(data, 'session', t('reviewList.all'), (value) => t(value === 'present' ? 'reviewList.sessionPresent' : 'reviewList.sessionMissing')),
  }
  // the fleet's work state ([[issue-binding]]) — the same low-cardinality menu grammar the presence facet uses.
  const fleetFacet = {
    label: t('reviewList.facetFleet'), value: readToken(text, 'fleet'),
    options: facetOptions(data, 'fleet', t('reviewList.all'), (value) => t(`reviewList.fleet${value[0].toUpperCase()}${value.slice(1)}`)),
  }
  // the sub-issue tree's two display dimensions ([[review-filters]] arranges them before paging) — the same menu
  // grammar; a typed default spelling (`sub:top`, `group:none`) is the default, so the menu never counts it active.
  const treeValue = (key, defaultSpelling) => { const value = readToken(text, key); return value === defaultSpelling ? '' : value }
  const subFacet = {
    label: t('reviewList.facetSub'), value: treeValue('sub', 'top'), clearLabel: t('reviewList.subTop'),
    options: facetOptions(data, 'sub', t('reviewList.subTop'), () => t('reviewList.subAll')),
  }
  const groupFacet = {
    label: t('reviewList.facetGroup'), value: treeValue('group', 'none'), clearLabel: t('reviewList.groupNone'),
    options: facetOptions(data, 'group', t('reviewList.groupNone'), () => t('reviewList.groupParent')),
  }

  return (
    <ListPage
      loading={loading}
      error={error}
      title={t('reviewList.issuesTitle')}
      action={newAction}
      search={{
        value: String(query.q ?? '').trim() ? query.q : ISSUE_QUERY_DEFAULT,
        onSubmit: push,
        placeholder: t('reviewList.searchIssues'),
        label: t('reviewList.search'),
        keys: ISSUE_QUERY_KEYS,
        // bounded autocomplete candidates for the HIGH-cardinality tokens: values present in the data
        // only; an unknown or historical value still submits verbatim.
        suggest: {
          author: facetOptions(data, 'author', t('reviewList.all')).filter((option) => option.value),
          node: facetOptions(data, 'node', t('reviewList.all')).filter((option) => option.value),
          label: facetOptions(data, 'label', t('reviewList.all')).filter((option) => option.value),
        },
      }}
      sections={[
        // Open is the DEFAULT section: with no state: token it stays the active tab, so the tablist
        // always exposes one roving tab stop; every non-open state spelling belongs to Closed.
        { key: 'open', label: t('reviewList.open'), count: openCount, active: section === '' || section === 'open', onSelect: () => surgery('state', 'open') },
        { key: 'closed', label: t('reviewList.closed'), count: closedCount, active: section !== '' && section !== 'open', onSelect: () => surgery('state', 'closed') },
      ]}
      facets={
        <FacetMenu label={storeFacet.label} value={storeFacet.value} options={storeFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => surgery('store', value)} mobile />
      }
      secondaryFilters={<SecondaryFilters label={t('reviewList.filters')} clearLabel={t('reviewList.all')} groups={[
        { label: sessionFacet.label, value: sessionFacet.value, active: !!sessionFacet.value, options: sessionFacet.options, onChange: (value) => surgery('session', value) },
        { label: fleetFacet.label, value: fleetFacet.value, active: !!fleetFacet.value, options: fleetFacet.options, onChange: (value) => surgery('fleet', value) },
        { label: subFacet.label, value: subFacet.value, active: !!subFacet.value, options: subFacet.options, clearLabel: subFacet.clearLabel, onChange: (value) => surgery('sub', value) },
        { label: groupFacet.label, value: groupFacet.value, active: !!groupFacet.value, options: groupFacet.options, clearLabel: groupFacet.clearLabel, onChange: (value) => surgery('group', value) },
      ]} />}
      rows={rows}
      pagination={data ? {
        page: data.page, pageCount: data.pageCount, prev: data.prev, next: data.next,
        hrefFor: (target) => routeHash('issues', null, reviewRouteQuery(text, ISSUE_QUERY_DEFAULT, target)),
      } : null}
      empty={{
        hasData: (data?.sourceTotal ?? 0) > 0,
        dataset: t('session.issuesEmpty'),
        filtered: t('session.issuesNoMatch'),
      }}
    />
  )
}


// the fleet's declaration ledger ([[issue-binding]]): one timeline read per fleet session, re-read when a fleet
// row's status or note moves on the board (the same push the rail repaints on). Read-time only — the issue
// stores nothing — and a failed read is an empty ledger for that session, never a broken thread.
function useFleetLedger(fleet, since) {
  const [ledger, setLedger] = useState([])
  const key = fleet.map((s) => `${s.id}:${s.status}:${s.note || ''}`).join('|')
  useEffect(() => {
    let live = true
    if (!fleet.length) { setLedger([]); return undefined }
    Promise.all(fleet.map((s) => loadSessionTimeline(s.id, { limit: 60 }).then((w) => ledgerFromTimeline(s.id, w?.events)).catch(() => [])))
      .then((all) => { if (live) setLedger(ledgerSince(all.flat(), since)) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, since])
  return ledger
}

// a linked issue as a rail value: its concern, led by its state mark (or by a relation's flag), its id on the tooltip.
function IssueLink({ issue, flag = null, className = '' }) {
  return (
    <SideValue text={issue.concern || issue.id} tip={issue.id} href={routeHash('issues', issue.id)} className={className}
      lead={flag || (issue.status ? <ReviewState kind="issue" state={issue.status} size={12} /> : null)} />
  )
}

// the issue's RELATIONS as the read-time graph gives them, both directions ([[issues]]): what blocks it, what it blocks,
// what relates either way, and the duplicate edge each way — one row per edge, deduplicated within its kind.
const relationRows = (th) => {
  const rows = []
  const push = (kind, ids) => { for (const id of new Set(ids)) rows.push({ kind, id }) }
  const out = (type) => (th.relations || []).filter((r) => r.type === type).map((r) => r.id)
  push('blockedBy', th.blockedBy || [])
  push('blocks', out('blocks'))
  push('related', [...out('related'), ...(th.relatedBy || [])])
  push('duplicateOf', th.duplicateOf ? [th.duplicateOf] : [])
  push('duplicatedBy', th.duplicatedBy || [])
  return rows
}

// the detail's SUB-ISSUES section ([[issues-view]]): progress over the issue's own child counts, the children as the
// list page's own rows, a hide-completed switch over those rows of the one read, and the `+ Sub-issue` door — a real
// anchor to the compose page with the parent filled in, offered only where the store takes a sub-issue (an open local
// issue). The door prepares; the compose page writes.
function SubIssues({ issue, kids, sessions }) {
  const t = useT()
  const [hideDone, setHideDone] = useState(false)
  const closed = issue.childCounts?.closed ?? 0
  const total = (issue.childCounts?.open ?? 0) + closed
  // With no children there is NO block: a header-only section sitting above the thread made the replies below read
  // as "the sub-issues". The door to compose one lives in the rail (SubIssueDoor), where the page keeps its doors.
  if (!total) return null
  const shown = hideDone ? kids.filter((kid) => kid.status === 'open') : kids
  const progress = t('session.issuesSubCount', { closed, total })
  return (
    <section className="fv-subissues" aria-label={t('session.issuesSubTitle')}>
      <header className="fv-subissues-head">
        <span className="ds-side-label">{t('session.issuesSubTitle')}</span>
        {total > 0 && (
          <>
            <span className="fv-subissues-count" data-tip={progress}>{t('session.issuesSubProgress', { closed, total })}</span>
            <span className="fv-progress" role="progressbar" aria-label={progress} aria-valuemin={0} aria-valuemax={total} aria-valuenow={closed}>
              <span style={{ width: `${(closed / total) * 100}%` }} />
            </span>
          </>
        )}
        <span className="fv-subissues-actions">
          {closed > 0 && (
            <button type="button" className="ds-action" aria-pressed={hideDone} onClick={() => setHideDone((on) => !on)}>
              {t('session.issuesSubHideDone')}
            </button>
          )}
        </span>
      </header>
      {shown.length > 0 && (
        <div className="rl-list fv-subissues-rows">
          <ReviewRows rows={shown.map((kid) => issueRow(kid, { t, sessions }))} />
        </div>
      )}
    </section>
  )
}

// the rail's SUB-ISSUES row ([[issues-view]]): the count as a value and the `+ Sub-issue` door — a real anchor to the
// compose page with the parent filled in — offered only where the store takes a sub-issue (an open local issue).
// The door prepares; the compose page writes. It lives here, not in the main column, so a childless issue shows no
// empty block above its thread.
function SubIssueDoor({ issue }) {
  const t = useT()
  const closed = issue.childCounts?.closed ?? 0
  const total = (issue.childCounts?.open ?? 0) + closed
  const canAdd = issue.store === 'local' && issue.status === 'open'
  if (!total && !canAdd) return null
  return (
    <SideSection label={t('detail.sideSubIssues')}>
      {total > 0 && <SideValue text={t('session.issuesSubProgress', { closed, total })} dim />}
      {canAdd && <a className="ds-action" href={routeHash('issues', NEW_PARAM, { parent: issue.id })}><Icon name="plus" size={12} />{t('session.issuesSubNew')}</a>}
    </SideSection>
  )
}

// The DETAIL page (`#/issues/<id>`) — [[review-chrome]]'s GitHub-grammar skeleton: the concern ALONE as
// the title, the status band under it, the markdown body + reply thread as the MAIN column with the
// composer docked at its foot, and the store/originator/node/permalink metadata in the SIDE rail (reflowed
// above the body at phone width). One thread surface for both stores; the only store-specific affordances
// are metadata. Sign/accept/reject are not product verbs.
export function IssueDetailPage({ issue: th, specs, sessions, onOpenSession, onWrite, onQueryText }) {
  const t = useT()
  const local = th.store === 'local'
  const isConcluded = concluded(th)
  const [acting, setActing] = useState('')   // the lifecycle action in flight — one at a time
  const [actErr, setActErr] = useState('')
  const nodes = Array.isArray(th.nodes) ? th.nodes : []
  const labels = Array.isArray(th.labels) ? th.labels : []
  const replies = Array.isArray(th.replies) ? th.replies : []
  const status = th.status || 'open'
  const { fleet } = issueFleet(th, sessions)
  const ledger = useFleetLedger(fleet, th.created)
  // every issue the hierarchy links is titled from the read's own `refs` ([[issues]]) — one read, no request per link
  const refs = th.refs || {}
  const kids = (th.children || []).map((id) => refs[id]).filter(Boolean)
  const parent = th.parent ? refs[th.parent] : null
  const relations = relationRows(th)
  // the thread is a home of the one widget host ([[widgets]]): its replies draft into, and send from, this composer
  const widgetHost = useWidgetHost()
  const [composeSeed, setComposeSeed] = useState(null)   // a rail door's trigger for the composer to type, consumed once
  // what the thread shows — replies, fleet declarations and sub-issue events on one time line — counted once for its heading
  const threadLedger = [...ledger, ...ledgerFromChildren(kids)]
  const threadRows = [...replies, ...threadLedger]
  const run = (name, fn) => async () => {
    if (acting) return
    setActing(name)
    try {
      const res = await fn()
      if (res?.ok) { setActErr(''); await onWrite?.('') }
      else setActErr(res?.error || `${name} failed`)
    } finally {
      setActing('')
    }
  }
  const lifecycleBtn = (name, label, fn, title) => (
    <button type="button" className={`fv-close-issue fv-life-${name}`} disabled={!!acting} data-tip={title}
      onMouseDown={(e) => e.preventDefault()} onClick={run(name, fn)}>
      {acting === name ? t('session.issuesActing') : label}
    </button>
  )
  return (
    <DetailShell
      title={th.concern}
      backHref={detailBackHash('issues')}
      backLabel={t('detail.backToIssues')}
      status={
        <>
          <ReviewState kind="issue" state={status} showLabel className="ds-status-pill" size={16} />
          {/* the fleet's rolled-up work state beside the issue's own lifecycle mark ([[issue-binding]]) — derived, never stored */}
          <FleetWorkState fleet={fleet} />
          <FleetStrip fleet={fleet} />
        </>
      }
      side={
        <>
          {/* the issue's OWN identity, explicitly typed ([[review-chrome]]'s metadata law — a bare
              #slug reads as a node): a localized Issue label over the full id, shrink-truncated with
              the full slug on the tooltip. */}
          <SideSection label={t('detail.sideIssue')}>
            <SideValue text={th.id} mono />
          </SideSection>
          <SideSection label={t('detail.sideStore')}>
            <SideValue text={th.store} className={`fv-store fv-store-${local ? 'local' : 'forge'}`} />
            {th.url && <SideValue text={t('session.issuesOpenOnStore', { store: storeDisplayName(th.store) })} href={th.url} external />}
          </SideSection>
          {labels.length > 0 && (
            <SideSection label={t('detail.sideLabels')}>
              <IssueLabels labels={labels} onSelect={(name) => onQueryText?.(setToken(ISSUE_QUERY_DEFAULT, 'label', name))} />
            </SideSection>
          )}
          {/* the tree and the relation graph: the parent as a breadcrumb, then every edge led by its flag */}
          {parent && (
            <SideSection label={t('detail.sideParent')}>
              <IssueLink issue={parent} />
            </SideSection>
          )}
          <SubIssueDoor issue={th} />
          {relations.length > 0 && (
            <SideSection label={t('detail.sideRelations')}>
              {relations.map(({ kind, id }) => (
                <IssueLink key={`${kind}:${id}`} issue={refs[id] || { id }}
                  flag={<><span className={`fv-originator-dot fv-rel-${kind}`} aria-hidden="true" /><span className="ds-side-label fv-rel-key">{t(`detail.rel${kind[0].toUpperCase()}${kind.slice(1)}`)}</span></>} />
              ))}
            </SideSection>
          )}
          {/* the issue's FLEET ([[issue-binding]]): the sessions dispatched for it, as the one session forest with the
              one session menu, plus the dispatch door — the rail is where GitHub keeps assignees, and here the
              assignees are worktrees you can merge, relaunch, or close. */}
          <IssueSessions issue={th} sessions={sessions} onOpenSession={onOpenSession} onWrite={onWrite} onError={(message) => setActErr(message)} onCompose={setComposeSeed} />
          {nodes.length > 0 && (
            <SideSection label={t('detail.sideNodes')}>
              {nodes.map((id) => (
                <SideValue key={id} text={id} mono tip={t('session.issuesFocusNode')} href={addressHash(specAddress(id))} />
              ))}
            </SideSection>
          )}
        </>
      }
      composer={
        // the composer is DOCKED at the main column's foot ([[issues-view]]) — always on screen, the
        // thread scrolls behind it; keyed to the issue so a half-typed draft dies with its page instead of
        // leaking onto another issue's thread.
        <ReplyComposer
          key={th.id}
          onSend={(text, evidence, opts) => postIssueReply(th.id, text, evidence, opts)}
          specs={specs}
          sessions={sessions}
          focusId={nodes[0] || null}
          onDone={onWrite}
          widgetHost={widgetHost}
          seed={composeSeed}
          onSeedConsumed={() => setComposeSeed(null)}
          actionsEnd={!isConcluded && (
            <>
              {actErr && <span className="fv-error">{actErr}</span>}
              {local && lifecycleBtn('promote', t('session.issuesPromote'), () => postIssuePromote(th.id), t('session.issuesPromoteTitle'))}
              {lifecycleBtn('close', t('session.issuesCloseIssue'), () => postIssueClose(th.id), t('session.issuesCloseIssueTitle'))}
            </>
          )}
        />
      }
    >
      {th.duplicateOf && (
        <div className="fv-duplicate" role="note">
          <Icon name="circle-minus" size={14} />
          <span>{t('session.issuesDuplicateOf')}</span>
          <a href={routeHash('issues', th.duplicateOf)}>{refs[th.duplicateOf]?.concern || th.duplicateOf}</a>
        </div>
      )}
      {th.body && <div className="fvd-body"><SpecBody body={th.body} /></div>}
      <SubIssues issue={th} kids={kids} sessions={sessions} />
      {threadRows.length > 0 && <h2 className="fv-thread-head">{t('session.issuesThread', { n: threadRows.length })}</h2>}
      <Replies replies={replies} sessions={sessions} ledger={threadLedger} widgetHost={widgetHost} />
    </DetailShell>
  )
}

// The OPEN thread follows the board's issue freshness stamp ([[issues-view]] write-visibility): every thread
// write — a reply, a close, a promote — moves that one stamp, so an EXTERNAL write reaches an already-open
// reader on the push instead of waiting for a reload. A detail is a single
// addressed read, so the stamp is the ONLY thing that can tell it its thread may have moved.
// Only a new ADDRESS may wipe to the loading face — a stamp tick re-reads quietly behind the painted
// thread, the same rule the paged list follows.
function useIssueDetail(id, freshness) {
  const [issue, setIssue] = useState(null)
  const [error, setError] = useState(null)
  const seq = useRef(0)
  const reload = useCallback(async () => {
    if (!id) return null
    const mine = ++seq.current
    setError(null)
    try {
      const value = await loadIssue(id)
      if (mine === seq.current) setIssue(value)
      return value
    } catch (reason) {
      if (mine === seq.current) { setIssue(false); setError(reason instanceof Error ? reason.message : String(reason)) }
      return null
    }
  }, [id])
  const shownId = useRef(null)
  useEffect(() => {
    if (id !== shownId.current) { shownId.current = id; setIssue(null); setError(null) }
    if (id) reload()
  }, [id, freshness, reload])
  return { issue, error, reload }
}

// the route arrives as PROPS ([[view-registry]]'s one contract): this page is mounted in a pane that may
// not be the one showing, and a view that reads the global address follows the reader out of its own pane.
export default function IssuesPage({ param = null, query = EMPTY_QUERY, onOpenSession, specs = [], sessions = [], issuesStamp = null }) {
  const t = useT()
  const scope = useViewScope()
  const showing = usePaneActive()
  const { notify } = useTransientNotice()
  const composing = param === NEW_PARAM
  const text = String(query.q ?? '').trim() || ISSUE_QUERY_DEFAULT
  const page = reviewPageNumber(query.page)
  // the compose page reads the SAME one review request the list reads ([[paged-review]]) — the writable
  // stores are that contract's own facts, so a direct open of #/issues/new needs no second endpoint.
  // Both surfaces refresh on what their response actually DEPENDS on, never on board-frame identity churn
  // that merely happens to change on every applied patch (a key like that reads as freshness while being
  // blind to the data — it would go silent the day the board reconstruction is memoized). A paged list
  // answer has two board inputs: the merged issue population, carried by the board's issue-freshness stamp,
  // and the source-session presence join ([[live-session-filter]]), carried by the session id set. Equal
  // key = equal answer, so a quiet board costs no request and neither input can move unnoticed.
  const presenceKey = useMemo(() => sessions.map((s) => s.id).join(','), [sessions])
  // a hidden pane does not fetch: the pool keeps documents WARM, not busy ([[workspace-shell]]).
  const list = useReviewPage('issues', text, page, { enabled: (!param || composing) && showing, refreshKey: `${issuesStamp ?? ''}|${presenceKey}` })
  const detail = useIssueDetail(composing ? null : param, issuesStamp)
  // An issue is the one document the board holds no projection of, so the strip cannot name its tab
  // ([[tab-strip]]'s labels). The detail already has the concern; it reports it once and the frame keeps it.
  useReportDocumentName(param && !composing ? routeHash('issues', param) : null, detail.issue?.concern)
  const flash = (outcomes) => { if (outcomes) notify(outcomes) }
  const onWrite = async (outcomes) => { flash(outcomes); await (param ? detail.reload() : list.reload()) }
  const onQueryText = (nextText) => scope.ownQuery(queryParam(nextText, ISSUE_QUERY_DEFAULT))

  if (composing) {
    if (list.data && !list.data.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>
    const writeStores = Array.isArray(list.data?.stores) && list.data.stores.length ? list.data.stores : [{ id: 'local', label: 'local', kind: 'local' }]
    return <NewIssuePage specs={specs} sessions={sessions} stores={writeStores} parent={query.parent || null} issuesStamp={issuesStamp}
      // the created issue is where the writer belongs; the spent compose address REPLACES ([[side-nav]]:
      // automatic state-naming replaces, so Back returns to the list, not to an emptied form).
      // a sub-issue composed from a parent returns to that parent (its Sub-issues section now lists the new one);
      // a top-level issue lands on itself.
      onCreated={(id, outcomes) => { flash(outcomes); scope.open({ page: 'issues', param: query.parent || id, query: null }, { replace: true }) }} />
  }

  if (param) {
    if (detail.issue == null) return <div className="fv-note">{t('session.issuesLoading')}</div>
    if (detail.error) return <DetailShell failure={detail.error} listHref={routeHash('issues')} listLabel={t('reviewShell.backToIssues')} />
    if (detail.issue === false) {
      // an address naming no issue renders the honest not-found with the list link ([[review-chrome]]).
      return <DetailShell missing={t('reviewShell.issueNotFound', { id: param })} listHref={routeHash('issues')} listLabel={t('reviewShell.backToIssues')} />
    }
    // keyed by the issue, so a pending widget draft or a lifecycle error never carries over to another thread
    return <IssueDetailPage key={detail.issue.id} issue={detail.issue} specs={specs} sessions={sessions} onOpenSession={onOpenSession} onWrite={onWrite} onQueryText={onQueryText} />
  }
  return <IssuesListPage data={list.data} loading={list.loading} error={list.error} query={query} onQueryText={onQueryText} sessions={sessions} />
}

// canonical store display names — the permalink label derives from the issue's OWN `store` identity
// ([[issues-view]]): one data row per forge store, never a URL sniff and never a per-host branch in the
// component; a store without a row falls back to its raw id, so a new driver reads honestly before its
// row lands.
const STORE_DISPLAY_NAMES = { github: 'GitHub', gitlab: 'GitLab' }
const storeDisplayName = (id) => STORE_DISPLAY_NAMES[id] || id

// The COMPOSE page (`#/issues/new`) — the third address of the issues route family, GitHub's own
// new-issue grammar: a real PLACE (bookmarkable, reloadable, Back-restorable), never a pop-out over the
// list. It wears the SAME [[review-chrome]] `DetailShell` the detail page wears — the compact back anchor
// leading a title header, one main column, one metadata rail — and writes through the SAME [[composer]]
// surface every other writing box in the app uses (a quiet bordered box, a borderless auto-growing
// textarea, a persistent action row carrying the [[mentions]] `@`/`[[` doors), so New is not a second
// dialect of "an input". A `[[node]]` link in the prose IS the node link — local infers `nodes:`, a forge
// post writes the `Spec:` marker from the same prose — and the rail SHOWS the links it will make, so no
// separate node-ids field exists. Write/Preview renders the draft through the one SpecBody the detail page
// renders it with, so what the writer proofreads is what the issue will look like.
function NewIssuePage({ specs, sessions, stores: allStores, parent = null, issuesStamp = null, onCreated }) {
  const t = useT()
  // A sub-issue is composed FROM its parent, so the way out of the form is the parent's page — back anchor and
  // Cancel alike — never the list; without a parent the compose page returns to the list as before. Both are
  // REAL anchors derived from the address ([[address-routing]]), never history.back.
  const returnHref = parent ? routeHash('issues', parent) : detailBackHash('issues')
  const returnLabel = parent ? t('detail.backToParent') : t('detail.backToIssues')
  // `?parent=<id>` composes a sub-issue: only the local store holds a tree, so the picker narrows to it, and the rail
  // names the parent from its own addressed read.
  const stores = useMemo(() => (parent ? allStores.filter((s) => s.kind === 'local') : allStores), [parent, allStores])
  const parentIssue = useIssueDetail(parent, issuesStamp).issue
  const [store, setStore] = useState(stores[0]?.id || 'local')
  const [concern, setConcern] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const taRef = useRef(null)
  const { launchers } = useLaunchers()
  // on a PAGE the menu opens downward under the caret line — no pop-out boundary to clear, so no `up`/
  // `fixedAbove` overlay geometry ([[mentions]]).
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, launchers })
  useEffect(() => {
    if (!stores.some((s) => s.id === store)) setStore(stores[0]?.id || 'local')
  }, [stores, store])
  // the node links the prose ALREADY carries — the same `[[id]]` grammar the store derives `nodes:` from,
  // shown while writing instead of stated as a rule nobody can verify.
  const nodes = [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]))]
  // The shared delivery doors are explicit actions: the exact @ reference stays in the issue body, while the
  // selected id is sent separately so the backend can create first and then hand over the new issue.
  const mentioned = mentionedSessions(body, sessions)
  const submit = async (deliverTo = []) => {
    const c = concern.trim()
    if (!c || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await postIssueThread({ concern: c, body: body.trim() || undefined, store, parent: parent || undefined, deliverTo })
      if (res?.ok && res.id) onCreated?.(res.id, res.outcomes || '')
      else setErr(res?.error || t('session.issuesPostFailed'))
    } finally { setBusy(false) }
  }
  const tab = (on, label) => (
    <button type="button" role="tab" aria-selected={preview === on} className={`fv-tab ${preview === on ? 'on' : ''}`}
      onClick={() => setPreview(on)}>{label}</button>
  )
  return (
    <DetailShell
      title={t('session.issuesNewTitle')}
      backHref={returnHref}
      backLabel={returnLabel}
      side={
        <>
          {parent && (
            <SideSection label={t('detail.sideParent')}>
              <IssueLink issue={parentIssue || { id: parent }} />
            </SideSection>
          )}
          <SideSection label={t('session.issuesStoreLabel')}>
            <label className="fv-store-pick">
              <span className="sr-only">{t('session.issuesStoreLabel')}</span>
              <select value={store} disabled={busy} onChange={(e) => setStore(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.label || s.id}</option>)}
              </select>
            </label>
          </SideSection>
          <SideSection label={t('detail.sideNodes')}>
            {nodes.length > 0
              ? nodes.map((id) => <SideValue key={id} text={id} mono />)
              : <SideValue text={t('session.issuesNodesHint')} dim />}
          </SideSection>
        </>
      }
    >
      <div className="fv-new-page">
        <label className="fv-field">
          <span className="fv-field-label">{t('session.issuesTitleLabel')}</span>
          <input className="fv-input fv-new-title" value={concern} placeholder={t('session.issuesConcernPlaceholder')}
            disabled={busy} autoFocus onChange={(e) => setConcern(e.target.value)}
            onKeyDown={(e) => { if (composingKey(e)) return; if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
        </label>
        <div className="fv-field">
          <div className="fv-field-head">
            <span className="fv-field-label">{t('session.issuesBodyLabel')}</span>
            <div className="fv-tabs" role="tablist" aria-label={t('session.issuesBodyLabel')}>
              {tab(false, t('session.issuesWrite'))}
              {tab(true, t('session.issuesPreview'))}
            </div>
          </div>
          <ComposerSurface
            className="fv-new-compose"
            editor={preview
              ? (
                <div className="fv-new-preview" role="tabpanel">
                  {body.trim() ? <SpecBody body={body} /> : <span className="fv-new-hint">{t('session.issuesPreviewEmpty')}</span>}
                </div>
              )
              : (
                <div className="fv-tawrap" role="tabpanel">
                  <ComposerTextarea ref={taRef} className="fv-textarea" rows={1} value={body} placeholder={t('session.issuesBodyPlaceholder')}
                    disabled={busy} onChange={(e) => { setBody(e.target.value); ac.sync(e.target) }}
                    onSelect={(e) => ac.sync(e.target)} onBlur={ac.close}
                    onKeyDown={(e) => { if (composingKey(e)) return; if (ac.onKeyDown(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
                  {ac.menuEl}
                </div>
              )}
            footer={
              <div className="fv-actions">
                <TriggerButton label={t('thread.mentionActor')} disabled={busy || preview}
                  onClick={() => typeTrigger(taRef.current, '@', setBody, ac.sync)}>@</TriggerButton>
                <TriggerButton label={t('thread.mentionNode')} disabled={busy || preview}
                  onClick={() => typeTrigger(taRef.current, '[[', setBody, ac.sync)}>[[</TriggerButton>
              </div>
            }
          />
        </div>
        <div className="fv-new-actions">
          {err && <span className="fv-error">{err}</span>}
          <SendToSessionActions sessions={mentioned} disabled={busy || preview} sendable={!!concern.trim()} onSend={(id) => submit([id])} />
          {/* Cancel is the same return the back anchor is — a REAL list anchor, never history.back. */}
          <a className="fv-cancel" href={returnHref}>{t('session.issuesCancel')}</a>
          <button type="button" className="fv-post" disabled={busy || !concern.trim()} onClick={submit}>
            {busy ? t('session.issuesSending') : t('session.issuesPost')}
          </button>
        </div>
      </div>
    </DetailShell>
  )
}

---
title: plugins-page
status: active
hue: 40
desc: The rail's automation board — a bounded master/detail frame reading every plugin by the surface it plugs into, hooks grouped under the lifecycle event they fire on, and the selected plugin's own contract text and script beside it.
code:
  - spec-dashboard/src/PluginsView.jsx
related:
  - spec-dashboard/src/views.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/Segmented.jsx
  - spec-dashboard/src/useResizable.js
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-cli/src/plugins-view.ts
---

# plugins-page

A fifth rail board, beside Spec, Sessions, Issues and Settings, for the automation the project runs on
itself. It reads [[plugins-view]] and draws nothing it did not receive.

## it exists to change the READING, not to add the nodes

Every plugin here is already a spec node and already visible in the graph with its own hue. So this board
is not "make them visible" — that was already true — it is to read them by WHAT THEY DO rather than by
what they are. Two things a spec tree structurally cannot say are the whole reason for the board: a node
that plugs into two surfaces at once can appear only once in a tree, and a hook's event, its order inside
that event, and whether it may refuse have nowhere in a tree to live.

## the spine is the hook surface and only the hook surface

The events are the master list's group headings, in the order an agent meets them over one session, and
each hook sits under the event it fires on, in its order, marked when it may refuse. Making the spine the
list's headings rather than a drawn rail is what lets it survive being a board: the heading pins while its
own hooks scroll under it, so the event you are reading is always overhead instead of a label you scrolled
past. An event carrying two hooks is where the order stops being decoration. An event carrying none is
simply absent from a filtered list — a group with no rows is a heading about nothing.

The other surfaces have no timeline and are not forced onto one: always-on prose and invocable verbs are
two more groups under the same headings, which is the honest shape, because they are not lined up in time.
The bar's filter is the one control that narrows this, and it narrows the READING only — [[plugins-view]]
always answers with the whole inventory, and the count says how much of it is showing.

## the question is what a thing DOES, and the answer is its own text

A name and a number is a fact nobody asked for. The question a person brings here is what a plugin does and
why it is allowed to refuse, and both answers are already written — a node's `desc` is its one line, its
body is the contract, and a hook's script is the rest. None of that is restated or summarized anywhere on
this board: the detail pane shows the node's own body and the bytes of the files beside it, read live
through [[plugins-view]].

That is also the difference the split buys. When each row was a link out, reading one plugin cost the whole
window and reading three meant three round trips; the text was in the product but never on this page. Now
the row selects and the text arrives beside it. The one link that still leaves is explicit, named, and in
the detail's header, because opening the node for real — history, issues, editing — is a different act from
reading what it says.

The seven hooks had no `desc` at all when this board first drew them, which is how it shipped as a grid of
names and numbers explaining nothing. They have one each now: a plugin that cannot say what it is for in one
line is a plugin nobody can review.

## a marker for the ordinary case is not drawable

The first version was a badge farm — order, refusal, file count and surface all drawn as chips on every row,
so nothing stood out because everything was marked. The repair is not "fewer chips". It is that the ordinary
case must have no representation at all, enforced where the marker is built rather than remembered at each
call: the mark component renders nothing unless the thing it names is true, `order` is drawn only on an event
carrying more than one hook (the sole place the number decides anything — elsewhere vertical position already
says it), and a hook's file count is never drawn, because the manifest compiler refuses a hook that does not
ship exactly one script, so the count is a constant there. A row with nothing remarkable is its name and its
sentence, which is what a reader should be able to skim past.

## the colour budget is one narrow column

A hook that may refuse its event puts a mark in the rail at the row's left edge, and nothing else on this
board is tinted — so the hooks that can interrupt a session form a broken vertical line down the left that a
reader finds without reading. The row itself is never coloured: a tinted row spends a whole line to say one
word. The single exception is a node on two surfaces at once, which is the one fact a folder tree structurally
cannot show, so it is the one that earns a hue.

A hook the profile turned off is drawn quieter than the metadata beside it, not merely greyer than the name:
its text is mixed toward the page's own ground, below `--muted`, because a reader should skim past it. Its
refusal mark keeps full strength — what it would do if it ran has not changed.

## the list row is a name, because the sentence has somewhere better to be

One tier in the list: the name, in the sidebars' row grammar, with the marks that change a reading pushed to
its edges. The sentence that used to sit under every name is the detail pane's first paragraph now, where it
is read once and in full instead of twenty-five times in truncated parallel — and a list of names is what
makes the list scannable at all, which is the job a master list has.

There is no third rank anywhere here, because this frame already spends the proportional/mono contrast
channel globally — `--ui-font` IS the mono — so size and colour carry a ranking a product with two typefaces
would split three ways.

Rows are borderless and tight, like every other list this frame draws: a box around a card is a border spent
on a rectangle rather than on the thing inside it. The group heading is a hairline and a count pod, never a
drawn graphic — which is also how every workflow console worth copying draws one, because a border survives
reflow and virtualisation and an SVG does not.

## the profile is the switch, and it is read here, never written

Every core hook's body opens by saying the startup `SPEX_PROFILE` list may disable it with a clean no-op, so
that list is this surface's configuration and a board that omits it shows seven things that may or may not be
running. It is shown as the state it is — which profile is active, how many hooks it keeps, which it turns
off, with a disabled hook greyed in place rather than hidden. The board does not write it: the profile is an
environment variable of the process an agent launches under, not a project setting this page owns.

## the board says what the automation IS, never how a branch is doing

The rows here are declarations: which surface a node plugs into, which event it binds, whether it may
refuse. None of that changes between one session and the next, so a number that DOES change belongs to a
board about work, not to this one. An earlier draft carried a health bar counting live worktrees against
declared contracts, and its denominator was wrong three times running — dormant directories, then live
sessions, then, on inspection, branch age — because the quantity it wanted did not exist on this surface to
be counted correctly. That is the general rule, not an anecdote about one bar: a figure this page cannot
derive from the plugin definitions it reads is a figure this page must not draw, and the reader who wants
the fleet's state has [[sessions-view]] for it.

## a board is a frame, not a document

THE SHAPE IS THE ARGUMENT. This page was a single column in the shared scrollport: three stacked sections,
one scrollbar, and every row a link out. That is the shape of a settings page — read once, top to bottom,
left behind — and it is the wrong shape for a project's automation, which is a thing you come back to and
work. A surface you manage holds still while you work it. So the root is a bounded pane, the bar and the
split never move, and the list and the detail own their own overflow: reading one plugin does not scroll
the controls off the top, and a long script does not push the inventory out of reach.

That bounded root is why this page takes no [[page-scroll]]. It is not an oversight repeating the one this
page already made once: that primitive is for documents that scroll as a whole, and it exempts bounded
panes deliberately, exactly as the graph canvas and the session console are exempt.

**The split is not a second navigator.** The frame's one navigator belongs to the window and is drawn once
([[workspace-shell]]); a page that draws another has forked the product's sense of where you are. This
list is the parts of THIS document — the plugins the board is about — the way [[diff-document]]'s file
panel is the parts of one diff. The test is what a click does: selecting a row answers in the detail pane
and changes no address, and the one link that leaves is explicit and lives in the detail's own header.

Its rows are therefore the sidebars' one row grammar and its group headings the zone grammar, pinned so the
lifecycle event a hook runs on stays overhead while its siblings scroll under it. The divider is the shared
resizable pane, clamped so the detail keeps at least half the width, and it stacks to a band above the
detail on a phone.

The board is still `resident`, so the bare address is its one tab identity, and it is still absent from the
published-tree page set because a static publication has no live plugin surface to read.

## colour is spent against the surface, never between two inks

Every state on the board — matching, differing, absent, blocking — is a palette token. A colour mixed
between two ink tokens flips direction between light and dark palettes and can collapse to invisible on
one of them; the live seam's sweep lost a whole theme that way ([[conversation]]).

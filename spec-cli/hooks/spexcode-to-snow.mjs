#!/usr/bin/env node
/**
 * @@@ spexcode-to-snow - convert SpexCode's plugin surfaces into Snow CLI's own discovery dirs.
 *
 * SpexCode materializes its plugin surfaces into EACH harness's config (`.claude/skills/<name>/SKILL.md`,
 * `CLAUDE.md`'s managed block, `.claude/settings.json` hooks). Snow CLI reads NONE of those paths — it
 * discovers skills under `.snow/skills/` and commands under `.snow/commands/`. This script bridges the two
 * surfaces that ARE portable:
 *
 *   skill   → `.snow/skills/<name>/SKILL.md`   (same agentskills.io primitive: name+description + body)
 *   command → `.snow/commands/<name>.json`     (Snow's {type:'prompt', command, description} shape)
 *
 * `system` (the contract prose) is NOT converted here — it already reaches Snow through AGENTS.md, which
 * materialize folds the same bodies into. `hook` is NOT converted here either — snow-bridge.mjs wires those
 * into `.snow/hooks/*.json` with the exit-code translation Snow needs.
 *
 * SOURCE OF TRUTH: the `.plugins` nodes under `.spec/<root>/`. Reading them (not `.claude/skills/`) keeps the
 * conversion reproducible from the tree itself, and works even when the claude harness was never materialized.
 *
 * Usage: node spexcode-to-snow.mjs <repo-root>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

const repo = process.argv[2]
if (!repo) {
  console.error('usage: node spexcode-to-snow.mjs <repo-root>')
  process.exit(2)
}

// --- locate the spec root + its .plugins instance ------------------------------------------------
const specDir = join(repo, '.spec')
const rootNode = readdirSync(specDir, { withFileTypes: true })
  .find((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(specDir, e.name, 'spec.md')))
if (!rootNode) {
  console.error(`no spec root node under ${specDir}`)
  process.exit(1)
}
const plugins = join(specDir, rootNode.name, '.plugins')
if (!existsSync(plugins)) {
  console.error(`no .plugins under ${join(specDir, rootNode.name)} — run \`spex init\` first`)
  process.exit(1)
}

// --- frontmatter parser (CRLF-tolerant, same shape SpexCode writes) ------------------------------
function parseFrontmatter(src) {
  const text = src.replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const fm = {}
  let body = text
  if (m) {
    let key = null
    for (const line of m[1].split('\n')) {
      const item = line.match(/^\s*-\s+(.*)$/)
      if (item && key) {
        if (!Array.isArray(fm[key])) fm[key] = fm[key] ? [fm[key]] : []
        fm[key].push(item[1].trim())
        continue
      }
      const i = line.indexOf(':')
      if (i > 0) {
        key = line.slice(0, i).trim()
        fm[key] = line.slice(i + 1).trim()
      }
    }
    body = m[2]
  }
  return { fm, body }
}

// --- walk one surface dir: every node with a spec.md declaring `surface: <name>` -----------------
function collect(surface) {
  const out = []
  const visit = (dir, name) => {
    const spec = join(dir, 'spec.md')
    if (existsSync(spec)) {
      const { fm, body } = parseFrontmatter(readFileSync(spec, 'utf8'))
      const surfaces = String(fm.surface || '')
        .split(',')
        .map((s) => s.trim())
      if (surfaces.includes(surface) && fm.status !== 'pending') {
        out.push({ name, title: fm.title || name, desc: fm.desc || '', body: body.trim(), dir })
      }
    }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) visit(join(dir, e.name), e.name)
    }
  }
  for (const shelf of readdirSync(plugins, { withFileTypes: true })) {
    if (shelf.isDirectory()) visit(join(plugins, shelf.name), shelf.name)
  }
  return out
}

const skills = collect('skill')
const commands = collect('command')

// --- write .snow/skills/<name>/SKILL.md -----------------------------------------------------------
// Snow's skill id comes from the DIRECTORY name; the SKILL.md frontmatter carries name+description (the
// load-trigger). SpexCode's `desc` is already written as a load-trigger sentence, so it maps 1:1.
const skillsDir = join(repo, '.snow', 'skills')
let skillCount = 0
for (const s of skills) {
  const dir = join(skillsDir, s.name)
  mkdirSync(dir, { recursive: true })
  // co-located bundle files (a skill may ship scripts) travel with it
  for (const f of readdirSync(s.dir, { withFileTypes: true })) {
    if (f.isFile() && f.name !== 'spec.md') {
      writeFileSync(join(dir, f.name), readFileSync(join(s.dir, f.name)))
    }
  }
  const content = `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.desc)}\n---\n\n${s.body}\n`
  writeFileSync(join(dir, 'SKILL.md'), content)
  skillCount++
}

// --- write .snow/commands/<name>.json -------------------------------------------------------------
// Snow's command is a JSON record: {type:'prompt', command, description}. The SpexCode command body is a
// PROMPT (it instructs the agent), so type=prompt. SpexCode's own `{{targets}}` placeholder is filled by ITS
// launcher with @-referenced nodes; Snow has no such filler, so it is translated to Snow's `$ARGUMENTS`
// (the documented placeholder both tools share) — a command invoked bare then substitutes empty, and one
// invoked with text lands it exactly where SpexCode put its targets.
const commandsDir = join(repo, '.snow', 'commands')
let commandCount = 0
for (const c of commands) {
  mkdirSync(commandsDir, { recursive: true })
  const prompt = c.body.replace(/\{\{targets\}\}/g, '$ARGUMENTS')
  const record = {
    type: 'prompt',
    command: prompt,
    description: c.desc || c.title,
  }
  writeFileSync(join(commandsDir, `${c.name}.json`), JSON.stringify(record, null, 2) + '\n')
  commandCount++
}

console.log(`spexcode → snow (${repo})`)
console.log(`  skills   → .snow/skills/    : ${skillCount} (${skills.map((s) => s.name).join(', ')})`)
console.log(`  commands → .snow/commands/  : ${commandCount} (${commands.map((c) => c.name).join(', ')})`)
console.log(`  hooks    : wired separately by snow-bridge.mjs (.snow/hooks/*.json)`)
console.log(`  system   : already reaches Snow through AGENTS.md`)

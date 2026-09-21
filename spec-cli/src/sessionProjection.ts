export type OrderedSessionRow = {
  id: string
  created: number
  sortKey?: number | null
}

// Merge the rows named by one committed session change into the last board projection. A missing row means
// removal only when that id was already visible; an unseen id is ambiguous (new worktree, archived, or deleted),
// so return null and make the caller obtain the authoritative full roster.
export function mergeSessionRows<Row extends OrderedSessionRow>(
  previous: readonly Row[],
  updated: readonly Row[],
  affectedSessionIds: readonly string[],
): Row[] | null {
  const ids = [...new Set(affectedSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (ids.length !== affectedSessionIds.length) return null
  const affected = new Set(ids)
  const previousById = new Map(previous.map((row) => [row.id, row]))
  const updatedById = new Map<string, Row>()
  for (const row of updated) {
    if (!row || typeof row.id !== 'string' || !affected.has(row.id) || updatedById.has(row.id)) return null
    updatedById.set(row.id, row)
  }
  // A new id may have a perfectly readable row, but its worktree/layout overlay is not present in `previous`.
  // Force the full producer so the graph cannot publish a session row without its topology.
  for (const id of ids) if (!previousById.has(id)) return null

  const merged = previous
    .filter((row) => !affected.has(row.id) || updatedById.has(row.id))
    .map((row) => updatedById.get(row.id) ?? row)
  for (const [id, row] of updatedById) if (!previousById.has(id)) merged.push(row)
  merged.sort((a, b) => (a.sortKey ?? a.created) - (b.sortKey ?? b.created) || a.id.localeCompare(b.id))
  return merged
}

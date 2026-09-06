export type LibraryQueryCondition = Readonly<{ kind: 'area' | 'taxonomy' | 'tag'; key: string; label: string }>
export type LibraryQueryFilters = Readonly<{ areaKeys: readonly string[]; taxonomyKeys: readonly string[]; tagIds: readonly string[] }>
const field = { area: 'areaKeys', taxonomy: 'taxonomyKeys', tag: 'tagIds' } as const
const limits = { area: 10, taxonomy: 10, tag: 20 } as const
export function interpretLibraryQuery(query: string, vocabulary: readonly LibraryQueryCondition[], manual: LibraryQueryFilters) {
  let text = query.trim()
  const conditions: LibraryQueryCondition[] = []
  const selected = { areaKeys: new Set(manual.areaKeys), taxonomyKeys: new Set(manual.taxonomyKeys), tagIds: new Set(manual.tagIds) }
  const counts = new Map<string, number>()
  const literal = (condition: LibraryQueryCondition) => `${condition.kind === 'tag' ? '#' : ''}${condition.label}`
  vocabulary.forEach((condition) => counts.set(literal(condition).toLocaleLowerCase(), (counts.get(literal(condition).toLocaleLowerCase()) ?? 0) + 1))
  for (const condition of [...vocabulary].sort((left, right) => literal(right).length - literal(left).length)) {
    const token = literal(condition)
    if (counts.get(token.toLocaleLowerCase()) !== 1) continue
    const keys = selected[field[condition.kind]]
    if (!keys.has(condition.key) && keys.size >= limits[condition.kind]) continue
    const escaped = token.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    const pattern = new RegExp(`(^|\\s)${escaped}(?=$|\\s)`, 'giu')
    if (!pattern.test(text)) continue
    text = text.replace(pattern, ' ').trim().replace(/\s+/g, ' ')
    keys.add(condition.key)
    conditions.push(condition)
  }
  return { text, conditions, filters: { areaKeys: [...selected.areaKeys], taxonomyKeys: [...selected.taxonomyKeys], tagIds: [...selected.tagIds] } }
}

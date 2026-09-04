import type { CatalogPlaceSearchSource } from './ports/catalog-place-search-source.js'
import type { CatalogSearchVocabulary } from './ports/catalog-search-vocabulary.js'
import type {
  CatalogAreaVocabularyNode,
  CatalogPlaceSearchInput,
  CatalogPlaceSearchPage,
  CatalogSearchInterpretation,
  CatalogSearchInterpretationToken,
  CatalogTaxonomyVocabularyNode,
} from '../domain/catalog-home-search.js'
import type { SearchBounds } from '../domain/model.js'

type Candidate = Readonly<{
  token: Exclude<CatalogSearchInterpretationToken, { kind: 'query' }>
  words: readonly string[]
  areaDepth: number
}>

function normalizeWords(value: string): readonly string[] {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/u).filter(Boolean)
}

const koreanParticles = ['으로', '에서', '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '로', '도', '만']

function matchesCandidateWord(queryWord: string, candidateWord: string, last: boolean): boolean {
  return queryWord === candidateWord || (
    last && koreanParticles.some((particle) => queryWord === `${candidateWord}${particle}`)
  )
}

function referenceToken(kind: 'area' | 'place-type' | 'attribute', key: string, version: number) {
  return `${kind}:${Buffer.from(key, 'utf8').toString('base64url')}:${version}`
}

function queryToken(normalizedQuery: string): string {
  return `query:${Buffer.from(normalizedQuery, 'utf8').toString('base64url')}`
}

function areaDepth(node: CatalogAreaVocabularyNode, nodes: ReadonlyMap<string, CatalogAreaVocabularyNode>): number {
  let depth = 0
  let parentKey = node.parentKey
  const seen = new Set([node.key])
  while (parentKey !== null && !seen.has(parentKey) && depth < 31) {
    seen.add(parentKey)
    depth += 1
    parentKey = nodes.get(parentKey)?.parentKey ?? null
  }
  return depth
}

function candidates(
  areas: readonly CatalogAreaVocabularyNode[],
  taxonomies: readonly CatalogTaxonomyVocabularyNode[],
): readonly Candidate[] {
  const areasByKey = new Map(areas.map((area) => [area.key, area]))
  const all = [
    ...areas.flatMap((area) => area.names.map(({ name }) => ({
      token: {
        tokenId: referenceToken('area', area.key, area.version),
        kind: 'area' as const,
        key: area.key,
        version: area.version,
        label: name,
      },
      words: normalizeWords(name),
      areaDepth: areaDepth(area, areasByKey),
    }))),
    ...taxonomies.map((taxonomy) => {
      const kind = taxonomy.kind === 'category' ? 'place-type' as const : 'attribute' as const
      return {
        token: {
          tokenId: referenceToken(kind, taxonomy.key, taxonomy.version),
          kind,
          key: taxonomy.key,
          version: taxonomy.version,
          label: taxonomy.label,
        },
        words: normalizeWords(taxonomy.label),
        areaDepth: -1,
      }
    }),
  ].filter((candidate) => candidate.words.length > 0)

  const unique = new Map<string, Candidate>()
  for (const candidate of all) {
    unique.set(`${candidate.token.tokenId}\u0000${candidate.words.join(' ')}`, candidate)
  }
  const meaningsByPhrase = new Map<string, Set<string>>()
  for (const candidate of unique.values()) {
    const phrase = candidate.words.join(' ')
    const meanings = meaningsByPhrase.get(phrase) ?? new Set<string>()
    meanings.add(candidate.token.tokenId)
    meaningsByPhrase.set(phrase, meanings)
  }
  return [...unique.values()]
    .filter((candidate) => meaningsByPhrase.get(candidate.words.join(' '))?.size === 1)
    .sort((left, right) => (
      right.words.length - left.words.length ||
      right.words.join(' ').length - left.words.join(' ').length ||
      right.areaDepth - left.areaDepth ||
      left.token.tokenId.localeCompare(right.token.tokenId)
    ))
}

export function interpretCatalogSearch(
  query: string,
  excludedTokenIds: readonly string[],
  areas: readonly CatalogAreaVocabularyNode[],
  taxonomies: readonly CatalogTaxonomyVocabularyNode[],
): CatalogSearchInterpretation {
  const words = normalizeWords(query)
  const consumed = new Array<boolean>(words.length).fill(false)
  const excluded = new Set(excludedTokenIds)
  const tokens: CatalogSearchInterpretationToken[] = []
  const taxonomyReferences: Array<{ key: string; version: number }> = []
  let selectedArea: { key: string; version: number } | undefined

  for (const candidate of candidates(areas, taxonomies)) {
    let matched = false
    for (let start = 0; start <= words.length - candidate.words.length; start += 1) {
      if (candidate.words.some((word, offset) => (
        consumed[start + offset] ||
        !matchesCandidateWord(words[start + offset]!, word, offset === candidate.words.length - 1)
      ))) {
        continue
      }
      for (let offset = 0; offset < candidate.words.length; offset += 1) consumed[start + offset] = true
      matched = true
    }
    if (!matched || excluded.has(candidate.token.tokenId)) continue
    if (candidate.token.kind === 'area') {
      if (selectedArea !== undefined) continue
      selectedArea = { key: candidate.token.key, version: candidate.token.version }
    } else {
      taxonomyReferences.push({ key: candidate.token.key, version: candidate.token.version })
    }
    tokens.push(candidate.token)
  }

  const normalizedQuery = words.filter((_, index) => !consumed[index]).join(' ')
  if (normalizedQuery.length > 0) {
    const tokenId = queryToken(normalizedQuery)
    if (!excluded.has(tokenId)) {
      tokens.push({ tokenId, kind: 'query', label: normalizedQuery, normalizedQuery })
    }
  }
  const kindOrder: Readonly<Record<CatalogSearchInterpretationToken['kind'], number>> = {
    area: 0,
    'place-type': 1,
    attribute: 2,
    query: 3,
  }
  tokens.sort((left, right) => (
    kindOrder[left.kind] - kindOrder[right.kind] || left.tokenId.localeCompare(right.tokenId)
  ))
  taxonomyReferences.sort((left, right) => {
    const leftKind = tokens.find((token) => (
      token.kind !== 'query' && token.key === left.key && token.version === left.version
    ))?.kind
    const rightKind = tokens.find((token) => (
      token.kind !== 'query' && token.key === right.key && token.version === right.version
    ))?.kind
    return kindOrder[leftKind ?? 'attribute'] - kindOrder[rightKind ?? 'attribute'] ||
      left.key.localeCompare(right.key) || left.version - right.version
  })
  const effectiveQuery = tokens.find((token) => token.kind === 'query')?.normalizedQuery ?? ''
  return {
    normalizedQuery: effectiveQuery,
    tokens,
    ...(selectedArea === undefined ? {} : { areaReference: selectedArea }),
    taxonomyReferences,
  }
}

function resultBounds(
  items: readonly Readonly<{
    location: Readonly<{ latitude: number; longitude: number }> | null
  }>[],
): SearchBounds | null {
  const locations = items.flatMap((item) => item.location === null ? [] : [item.location])
  if (locations.length === 0) return null
  const latitudes = locations.map((location) => location.latitude)
  const longitudes = locations.map((location) => location.longitude)
  let west = Math.min(...longitudes)
  let east = Math.max(...longitudes)
  let south = Math.min(...latitudes)
  let north = Math.max(...latitudes)
  const epsilon = 0.0005
  if (west === east) {
    west = Math.max(-180, west - epsilon)
    east = Math.min(180, east + epsilon)
  }
  if (south === north) {
    south = Math.max(-90, south - epsilon)
    north = Math.min(90, north + epsilon)
  }
  return { west, south, east, north }
}

function descendantKeys<T extends Readonly<{ key: string; parentKey: string | null }>>(
  selectedKey: string,
  nodes: readonly T[],
): ReadonlySet<string> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentKey === null) continue
    const siblings = children.get(node.parentKey) ?? []
    siblings.push(node.key)
    children.set(node.parentKey, siblings)
  }
  const descendants = new Set([selectedKey])
  const pending = [selectedKey]
  while (pending.length > 0 && descendants.size <= 1_024) {
    const parent = pending.shift()!
    for (const child of children.get(parent) ?? []) {
      if (descendants.has(child)) continue
      descendants.add(child)
      pending.push(child)
    }
  }
  return descendants
}

export function createCatalogPlaceSearch(dependencies: Readonly<{
  source: CatalogPlaceSearchSource
  vocabulary: CatalogSearchVocabulary
}>) {
  return async (input: CatalogPlaceSearchInput): Promise<CatalogPlaceSearchPage> => {
    const resolved = await resolveCatalogSearch(input, dependencies.vocabulary)
    const page = await dependencies.source.searchCatalog({
      query: resolved.interpretation.normalizedQuery,
      taxonomyReferences: resolved.interpretation.taxonomyReferences,
      taxonomyReferenceGroups: resolved.taxonomyReferenceGroups,
      limit: input.limit,
      ...(resolved.interpretation.areaReference === undefined
        ? {}
        : {
          areaReference: resolved.interpretation.areaReference,
          areaReferences: resolved.areaReferences,
        }),
      ...(input.bounds === undefined ? {} : { bounds: input.bounds }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    })
    return {
      schemaVersion: 'catalog-place-search.v1',
      interpretation: {
        normalizedQuery: resolved.interpretation.normalizedQuery,
        tokens: resolved.interpretation.tokens,
      },
      items: page.items,
      mapBounds: resultBounds(page.items),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
  }
}

export async function resolveCatalogSearch(
  input: Readonly<{ query: string; excludedTokenIds: readonly string[] }>,
  vocabulary: CatalogSearchVocabulary,
): Promise<Readonly<{
  interpretation: CatalogSearchInterpretation
  areaReferences: readonly Readonly<{ key: string; version: number }>[]
  taxonomyReferenceGroups: readonly (readonly Readonly<{
    key: string
    version: number
    kind: 'category' | 'attribute'
  }>[])[]
}>> {
  const [areas, taxonomies] = await Promise.all([
    vocabulary.listAreas(),
    vocabulary.listTaxonomies(),
  ])
  const interpretation = interpretCatalogSearch(
    input.query,
    input.excludedTokenIds,
    areas,
    taxonomies,
  )
  const areaReferences = interpretation.areaReference === undefined
    ? []
    : areas.filter(({ key }) => (
      descendantKeys(interpretation.areaReference!.key, areas).has(key)
    )).map(({ key, version }) => ({ key, version }))
  const taxonomyByKey = new Map(taxonomies.map((node) => [node.key, node]))
  const taxonomyReferenceGroups = interpretation.taxonomyReferences.map((reference) => {
    const selected = taxonomyByKey.get(reference.key)
    if (selected?.kind !== 'category') {
      return [{ ...reference, kind: selected?.kind ?? 'attribute' as const }]
    }
    const descendants = descendantKeys(selected.key, taxonomies)
    return taxonomies.filter((node) => node.kind === 'category' && descendants.has(node.key))
      .map(({ key, version, kind }) => ({ key, version, kind }))
  })
  return {
    interpretation,
    areaReferences,
    taxonomyReferenceGroups,
  }
}

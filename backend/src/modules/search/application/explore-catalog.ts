import type { CatalogSearchVocabulary } from './ports/catalog-search-vocabulary.js'
import type { CatalogPlaceSearchSource } from './ports/catalog-place-search-source.js'
import { interpretCatalogSearch } from './search-catalog-places.js'
import { narrowTaxonomyConditions } from './catalog-taxonomy-conditions.js'

type Destination = Readonly<{
  key: string; kind: 'country' | 'city' | 'administrative-area' | 'locality' | 'neighborhood'; name: string; names: readonly string[]; countryCode: string
  contextLabel?: string
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: Readonly<{ west: number; south: number; east: number; north: number }> | null
}>
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')

type Dependencies = Readonly<{
  source: CatalogPlaceSearchSource
  vocabulary: CatalogSearchVocabulary
  destinations: (query: string) => readonly Destination[]
}>

function exploration(dependencies: Dependencies, version: 1 | 2 = 1) {
  return async (query: string, near?: Readonly<{ latitude: number; longitude: number }>) => {
    const [areas, taxonomies, page] = await Promise.all([
      dependencies.vocabulary.listAreas(), dependencies.vocabulary.listTaxonomies(),
      dependencies.source.searchCatalog({ query, intent: 'name', taxonomyReferences: [], limit: 8,
        ...(near === undefined ? {} : { near }),
      }),
    ])
    const initial = interpretCatalogSearch(query, [], areas, taxonomies)
    const interpreted = version === 2 ? narrowTaxonomyConditions(initial, taxonomies) : initial
    const conditions = interpreted.tokens.filter((token) => token.kind !== 'query')
    const destinations = dependencies.destinations(query).slice(0, 8).map(({ names, ...destination }) => ({
      ...destination, exact: names.some((name) => normalize(name) === normalize(query)),
    }))
    const exactName = page.items.some((place) => normalize(place.name) === normalize(query)) ||
      destinations.some((destination) => destination.exact)
    return {
      intent: exactName || conditions.length === 0 ? 'name' as const
        : normalize(conditions[0]?.label ?? '') === normalize(query) ? 'auto' as const : 'conditions' as const,
      destinations, places: page.items, conditions, unrecognizedText: interpreted.normalizedQuery,
    }
  }
}

export function createCatalogExploration(dependencies: Dependencies) {
  const explore = exploration({ ...dependencies, destinations: (query) => dependencies.destinations(query)
    .filter((item) => item.kind === 'country' || item.kind === 'city') })
  return async (query: string, near?: Readonly<{ latitude: number; longitude: number }>) => {
    const result = await explore(query, near)
    return { ...result, schemaVersion: 'catalog-exploration.v1' as const,
      destinations: result.destinations.map(({ contextLabel: _, ...item }) => ({ ...item, kind: item.kind as 'country' | 'city' })) }
  }
}

export function createCatalogExplorationV2(dependencies: Dependencies) {
  const explore = exploration(dependencies, 2)
  return async (query: string, near?: Readonly<{ latitude: number; longitude: number }>) => {
    const result = await explore(query, near)
    // A recognized classification and an identically named place remain separate choices.
    const exactCondition = result.conditions.some((token) => normalize(token.label) === normalize(query))
    return { ...result, schemaVersion: 'catalog-exploration.v2' as const,
      intent: exactCondition ? 'auto' as const : result.intent }
  }
}

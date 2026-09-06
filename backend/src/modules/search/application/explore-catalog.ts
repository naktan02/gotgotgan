import type { CatalogSearchVocabulary } from './ports/catalog-search-vocabulary.js'
import type { CatalogPlaceSearchSource } from './ports/catalog-place-search-source.js'
import { interpretCatalogSearch } from './search-catalog-places.js'

type Destination = Readonly<{
  key: string; kind: 'country' | 'city'; name: string; names: readonly string[]; countryCode: string
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: Readonly<{ west: number; south: number; east: number; north: number }> | null
}>
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')

export function createCatalogExploration(dependencies: Readonly<{
  source: CatalogPlaceSearchSource
  vocabulary: CatalogSearchVocabulary
  destinations: (query: string) => readonly Destination[]
}>) {
  return async (query: string, near?: Readonly<{ latitude: number; longitude: number }>) => {
    const [areas, taxonomies, page] = await Promise.all([
      dependencies.vocabulary.listAreas(), dependencies.vocabulary.listTaxonomies(),
      dependencies.source.searchCatalog({ query, intent: 'name', taxonomyReferences: [], limit: 8,
        ...(near === undefined ? {} : { near }),
      }),
    ])
    const interpreted = interpretCatalogSearch(query, [], areas, taxonomies)
    const conditions = interpreted.tokens.filter((token) => token.kind !== 'query')
    const destinations = dependencies.destinations(query).slice(0, 8).map(({ names, ...destination }) => ({
      ...destination, exact: names.some((name) => normalize(name) === normalize(query)),
    }))
    const exactName = page.items.some((place) => normalize(place.name) === normalize(query)) ||
      destinations.some((destination) => destination.exact)
    return {
      schemaVersion: 'catalog-exploration.v1' as const,
      intent: exactName || conditions.length === 0 ? 'name' as const
        : normalize(conditions[0]?.label ?? '') === normalize(query) ? 'auto' as const : 'conditions' as const,
      destinations, places: page.items, conditions, unrecognizedText: interpreted.normalizedQuery,
    }
  }
}

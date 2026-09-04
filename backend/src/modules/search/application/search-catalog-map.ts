import type { CatalogPlaceMapSource } from './ports/catalog-place-map-source.js'
import type { CatalogSearchVocabulary } from './ports/catalog-search-vocabulary.js'
import { resolveCatalogSearch } from './search-catalog-places.js'
import {
  maximumCatalogMapFeatures,
  type CatalogPlaceMapInput,
  type CatalogPlaceMapResponse,
} from '../domain/catalog-map.js'

export function createCatalogPlaceMapSearch(dependencies: Readonly<{
  source: CatalogPlaceMapSource
  vocabulary: CatalogSearchVocabulary
}>) {
  return async (input: CatalogPlaceMapInput): Promise<CatalogPlaceMapResponse> => {
    if (input.maxFeatures < 1 || input.maxFeatures > maximumCatalogMapFeatures) {
      throw new Error('Catalog map feature budget is invalid.')
    }
    const resolved = await resolveCatalogSearch(input, dependencies.vocabulary)
    const projection = await dependencies.source.projectCatalogMap({
      query: resolved.interpretation.normalizedQuery,
      areaReferences: resolved.areaReferences,
      taxonomyReferenceGroups: resolved.taxonomyReferenceGroups,
      viewport: input.viewport,
      zoom: input.zoom,
      maxFeatures: input.maxFeatures,
    })
    const representedPlaceCount = projection.features.reduce(
      (total, feature) => total + feature.placeCount,
      0,
    )
    if (
      projection.features.length > input.maxFeatures ||
      representedPlaceCount !== projection.matchingPlaceCount
    ) {
      throw new Error('Catalog map source returned incomplete coverage.')
    }
    return {
      schemaVersion: 'catalog-place-map.v1',
      interpretation: {
        normalizedQuery: resolved.interpretation.normalizedQuery,
        tokens: resolved.interpretation.tokens,
      },
      viewport: input.viewport,
      zoom: input.zoom,
      mode: projection.mode,
      features: projection.features,
      coverage: {
        matchingPlaceCount: projection.matchingPlaceCount,
        representedPlaceCount,
        complete: true,
      },
    }
  }
}

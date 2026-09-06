import { classifyMapFeatures, type MapTaxonomyReader } from '../../../platform/map-projection/map-classification.js'
import { boundMapPreviews } from '../../../platform/map-projection/bounded-map-previews.js'
import type { MapFeature } from '../../../platform/map-projection/pixel-projection.js'
import type { CatalogSearchVocabulary } from './ports/catalog-search-vocabulary.js'
import { resolveCatalogSearch } from './search-catalog-places.js'
import { maximumCatalogMapFeatures, type CatalogPlaceMapInput, type CatalogPlaceMapQuery, type CatalogPlaceMapResponse } from '../domain/catalog-map.js'

export type CatalogPlaceMapInputV3 = CatalogPlaceMapInput & Readonly<{ selectedPlaceId?: string | undefined }>
export type CatalogPlaceMapQueryV3 = CatalogPlaceMapQuery & Readonly<{ selectedPlaceId?: string | undefined }>
export type CatalogPlaceMapResponseV3 = Omit<CatalogPlaceMapResponse, 'schemaVersion' | 'mode' | 'features'> & Readonly<{
  schemaVersion: 'catalog-place-map.v3'; mode: 'mixed'; features: readonly MapFeature[]
}>
export interface CatalogPlaceMapSourceV3 {
  projectCatalogMapV3(query: CatalogPlaceMapQueryV3): Promise<Readonly<{ features: readonly MapFeature[]; matchingPlaceCount: number }>>
}

export function createCatalogPlaceMapSearchV3(dependencies: Readonly<{
  source: CatalogPlaceMapSourceV3; vocabulary: CatalogSearchVocabulary; readTaxonomy?: MapTaxonomyReader
}>) {
  return async (input: CatalogPlaceMapInputV3): Promise<CatalogPlaceMapResponseV3> => {
    if (!Number.isInteger(input.maxFeatures) || input.maxFeatures < 1 || input.maxFeatures > maximumCatalogMapFeatures) {
      throw new Error('Catalog map feature budget is invalid.')
    }
    const resolved = await resolveCatalogSearch(input, dependencies.vocabulary)
    const projection = await dependencies.source.projectCatalogMapV3({
      ...(input.intent === undefined ? {} : { intent: input.intent }), selectedPlaceId: input.selectedPlaceId,
      query: resolved.interpretation.normalizedQuery, areaReferences: resolved.areaReferences,
      taxonomyReferenceGroups: resolved.taxonomyReferenceGroups, viewport: input.viewport,
      zoom: input.zoom, maxFeatures: input.maxFeatures,
    })
    const representedPlaceCount = projection.features.reduce((sum, feature) => sum + (feature.kind === 'place' ? 1 : feature.count), 0)
    if (projection.features.length > input.maxFeatures || representedPlaceCount !== projection.matchingPlaceCount) {
      throw new Error('Catalog map source returned incomplete coverage.')
    }
    return {
      schemaVersion: 'catalog-place-map.v3', interpretation: { normalizedQuery: resolved.interpretation.normalizedQuery, tokens: resolved.interpretation.tokens },
      viewport: input.viewport, zoom: input.zoom, mode: 'mixed',
      features: await classifyMapFeatures(boundMapPreviews(projection.features, input.maxFeatures), dependencies.readTaxonomy),
      coverage: { matchingPlaceCount: projection.matchingPlaceCount, representedPlaceCount, complete: true },
    }
  }
}

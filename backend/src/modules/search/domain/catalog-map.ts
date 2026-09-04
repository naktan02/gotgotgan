import type { CatalogSearchInterpretationToken } from './catalog-home-search.js'

export const maximumCatalogMapFeatures = 384
export const catalogMapDetailZoom = 12

export type CatalogMapViewport = Readonly<{
  west: number
  south: number
  east: number
  north: number
}>

export type CatalogPlaceMapInput = Readonly<{
  query: string
  excludedTokenIds: readonly string[]
  viewport: CatalogMapViewport
  zoom: number
  maxFeatures: number
}>

export type CatalogPlaceMapQuery = Readonly<{
  query: string
  areaReferences: readonly Readonly<{ key: string; version: number }>[]
  taxonomyReferenceGroups: readonly (readonly Readonly<{
    key: string
    version: number
    kind: 'category' | 'attribute'
  }>[])[]
  viewport: CatalogMapViewport
  zoom: number
  maxFeatures: number
}>

export type CatalogPlaceMapFeature =
  | Readonly<{
    kind: 'place'
    featureId: string
    placeId: string
    name: string
    location: Readonly<{ latitude: number; longitude: number }>
    areaLabel: string | null
    primaryTaxonomy: Readonly<{ key: string; label: string }> | null
    placeCount: 1
  }>
  | Readonly<{
    kind: 'cluster'
    featureId: string
    location: Readonly<{ latitude: number; longitude: number }>
    bounds: CatalogMapViewport
    placeCount: number
  }>

export type CatalogPlaceMapProjection = Readonly<{
  mode: 'places' | 'clusters'
  features: readonly CatalogPlaceMapFeature[]
  matchingPlaceCount: number
}>

export type CatalogPlaceMapResponse = Readonly<{
  schemaVersion: 'catalog-place-map.v1'
  interpretation: Readonly<{
    normalizedQuery: string
    tokens: readonly CatalogSearchInterpretationToken[]
  }>
  viewport: CatalogMapViewport
  zoom: number
  mode: 'places' | 'clusters'
  features: readonly CatalogPlaceMapFeature[]
  coverage: Readonly<{
    matchingPlaceCount: number
    representedPlaceCount: number
    complete: true
  }>
}>

import type { SearchBounds } from './model.js'

export type CatalogAreaVocabularyNode = Readonly<{
  key: string
  version: number
  parentKey: string | null
  names: readonly Readonly<{ languageTag: string; name: string }>[]
  defaultLanguageTag: string
}>

export type CatalogTaxonomyVocabularyNode = Readonly<{
  key: string
  version: number
  parentKey: string | null
  label: string
  kind: 'category' | 'attribute'
}>

export type CatalogSearchInterpretationToken =
  | Readonly<{
    tokenId: string
    kind: 'area' | 'place-type' | 'attribute'
    key: string
    version: number
    label: string
  }>
  | Readonly<{
    tokenId: string
    kind: 'query'
    label: string
    normalizedQuery: string
  }>

export type CatalogSearchInterpretation = Readonly<{
  normalizedQuery: string
  tokens: readonly CatalogSearchInterpretationToken[]
  areaReference?: Readonly<{ key: string; version: number }>
  taxonomyReferences: readonly Readonly<{ key: string; version: number }>[]
}>

export type CatalogPlaceSearchQuery = Readonly<{
  query: string
  areaReference?: Readonly<{ key: string; version: number }>
  areaReferences?: readonly Readonly<{ key: string; version: number }>[]
  taxonomyReferences: readonly Readonly<{ key: string; version: number }>[]
  taxonomyReferenceGroups?: readonly (readonly Readonly<{
    key: string
    version: number
    kind: 'category' | 'attribute'
  }>[])[]
  bounds?: SearchBounds
  cursor?: string
  limit: number
}>

export type CatalogPlaceSearchInput = Readonly<{
  query: string
  excludedTokenIds: readonly string[]
  bounds?: SearchBounds
  cursor?: string
  limit: number
}>

export type CatalogPlaceSummary = Readonly<{
  placeId: string
  name: string
  area: Readonly<{
    label: string
    reference: Readonly<{ key: string; version: number }> | null
  }> | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  primaryTaxonomy: Readonly<{
    key: string
    version: number | null
    label: string
  }> | null
  taxonomyReferences: readonly Readonly<{
    key: string
    version: number
    kind: 'category' | 'attribute'
  }>[]
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
  projectedAt: string
}>

export type CatalogPlaceSearchPage = Readonly<{
  schemaVersion: 'catalog-place-search.v1'
  interpretation: Readonly<{
    normalizedQuery: string
    tokens: readonly CatalogSearchInterpretationToken[]
  }>
  items: readonly CatalogPlaceSummary[]
  mapBounds: SearchBounds | null
  nextCursor?: string
}>

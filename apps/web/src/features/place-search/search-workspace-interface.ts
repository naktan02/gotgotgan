import type {
  PlaceSearchResult,
  PlaceSuggestion,
  TaxonomyNode,
} from '@place/contracts/search'
import type { ReactNode } from 'react'

import type { PlaceMapBounds, PlaceMapMarker } from '@/platform/maps/place-map-interface'

export type SearchMobileSurface = 'list' | 'map' | 'detail'

export type SearchCanonicalPlaceDetailRenderer = (input: Readonly<{
  placeId: string
  summary: Readonly<{
    name: string
    areaLabel: string | null
    location: Readonly<{ latitude: number; longitude: number }>
    primaryTaxonomy: Readonly<{ key: string; label: string }> | null
    evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
    sourceLabel: string
  }>
}>) => ReactNode

export type SearchControlsInterface = Readonly<{
  draftQuery: string
  taxonomyKey: string
  taxonomy: readonly TaxonomyNode[]
  suggestions: readonly PlaceSuggestion[]
  suggestionState: 'idle' | 'loading' | 'ready' | 'unavailable'
  suggestionOpen: boolean
  activeSuggestionIndex: number
  partial: boolean
  suggestionPartial: boolean
  error?: string
  searchViewportDisabled: boolean
  submitQuery: (query: string) => void
  chooseSuggestion: (suggestion: PlaceSuggestion) => Promise<void>
  changeDraftQuery: (value: string) => void
  closeSuggestions: () => void
  openSuggestions: () => void
  moveSuggestion: (offset: number) => void
  selectTaxonomy: (taxonomyKey: string) => void
  searchViewport: () => void
  retrySearch: () => Promise<void>
}>

export type SearchResultsInterface = Readonly<{
  items: readonly PlaceSearchResult[]
  nextCursor?: string
  selectedResultId?: string
  loading: boolean
  loadingMore: boolean
  error?: string
  boundsApplied: boolean
  mobileSurface: SearchMobileSurface
  loadMore: () => void
  selectResult: (resultId: string) => void
}>

export type SearchDetailInterface = Readonly<{
  selected?: PlaceSearchResult
  mobileSurface: SearchMobileSurface
  dismissDetail: () => void
  showList: () => void
}>

export type SearchMapInterface = Readonly<{
  bounds: PlaceMapBounds
  markers: readonly PlaceMapMarker[]
  selectedMarkerId?: string
  selectMarker: (markerId: string) => void
  panViewport: () => void
}>

export type SearchLayoutInterface = Readonly<{
  mobileSurface: SearchMobileSurface
  hasSelection: boolean
  showList: () => void
  showMap: () => void
}>

export type SearchWorkspaceWorkflow = Readonly<{
  controls: SearchControlsInterface
  results: SearchResultsInterface
  detail: SearchDetailInterface
  map: SearchMapInterface
  layout: SearchLayoutInterface
}>

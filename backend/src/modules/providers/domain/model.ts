export type ProviderKey = 'naver' | 'kakao' | 'google'

export type ProviderCapabilityDescriptor = Readonly<{
  providerKey: ProviderKey
  officialSearch: Readonly<{
    maxPageSize: number
    pagination: 'none' | 'page' | 'token'
    bounds: 'client-filtered' | 'server-rectangle'
  }>
  placeDetails: 'unsupported' | 'supported'
  placePhotos: 'unsupported' | 'supported'
}>

export type ProviderSearchBounds = Readonly<{
  west: number
  south: number
  east: number
  north: number
}>

export type ProviderSearchFilters = Readonly<{
  taxonomyKeys: readonly string[]
  saved?: boolean
  wanted?: boolean
  visited?: boolean
  minimumPersonalRating?: number
}>

export type ProviderSearchQuery = Readonly<{
  query: string
  bounds?: ProviderSearchBounds
  filters: ProviderSearchFilters
  cursor?: string
  limit: number
  viewerMemberId?: string
}>

export type ProviderAttribution = Readonly<{
  label: string
  uri?: string
}>

export type ProviderSearchResult = Readonly<{
  resultId: string
  identity: Readonly<{
    kind: 'provider'
    providerKey: ProviderKey
    providerPlaceId?: string
  }>
  source: Readonly<{
    key: string
    label: string
    externalUri?: string
    categoryLabel?: string
    detailsAvailable: boolean
    attributions: readonly ProviderAttribution[]
  }>
  freshness: Readonly<{
    kind: 'live'
    observedAt: string
  }>
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }>
  primaryTaxonomy: null
  taxonomyKeys: readonly string[]
  evidenceStatus: 'unverified'
}>

export type ProviderSearchPage = Readonly<{
  status: 'complete' | 'partial' | 'unavailable'
  items: readonly ProviderSearchResult[]
  nextCursor?: string
  errorCode?: string
}>

export interface ProviderPlaceSearch {
  readonly sourceKey: ProviderKey
  readonly capabilities: ProviderCapabilityDescriptor
  accepts(query: ProviderSearchQuery): boolean
  search(query: ProviderSearchQuery): Promise<ProviderSearchPage>
}

export type ProviderPlaceDetailRequest = Readonly<{
  providerKey: ProviderKey
  providerPlaceId: string
}>

export type ProviderPlaceDetail = Readonly<{
  schemaVersion: 'place-provider-detail.v1'
  providerKey: ProviderKey
  providerPlaceId: string
  name: string
  address: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  categoryLabel: string | null
  externalUri?: string
  phone?: string
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  openingHours?: Readonly<{
    openNow?: boolean
    weekdayDescriptions: readonly string[]
  }>
  photos: readonly Readonly<{
    mediaUri?: string
    width?: number
    height?: number
    authorAttributions: readonly ProviderAttribution[]
  }>[]
  attributions: readonly ProviderAttribution[]
  observedAt: string
}>

export interface ProviderPlaceDetails {
  readonly providerKey: ProviderKey
  get(request: ProviderPlaceDetailRequest): Promise<ProviderPlaceDetail>
}

export class ProviderDetailUnsupportedError extends Error {
  override readonly name = 'ProviderDetailUnsupportedError'
}

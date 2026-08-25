export type SearchBounds = Readonly<{
  west: number
  south: number
  east: number
  north: number
}>

export type SearchFilters = Readonly<{
  taxonomyKeys: readonly string[]
  saved?: boolean
  wanted?: boolean
  visited?: boolean
  minimumPersonalRating?: number
}>

export type PlaceSearchQuery = Readonly<{
  query: string
  bounds?: SearchBounds
  filters: SearchFilters
  cursor?: string
  limit: number
  viewerMemberId?: string
}>

export type PlaceSearchResult = Readonly<{
  resultId: string
  identity:
    | Readonly<{ kind: 'canonical'; placeId: string }>
    | Readonly<{
      kind: 'provider'
      providerKey: 'naver' | 'kakao' | 'google'
      providerPlaceId?: string
    }>
  source: Readonly<{
    key: string
    label: string
    externalUri?: string
    categoryLabel?: string
    detailsAvailable: boolean
    attributions: readonly Readonly<{ label: string; uri?: string }>[]
  }>
  freshness: Readonly<{
    kind: 'indexed' | 'live'
    observedAt: string
  }>
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }>
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  taxonomyKeys: readonly string[]
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
  personalState?: Readonly<{
    saved: boolean
    wanted: boolean
    visited: boolean
    personalRating: number | null
  }>
}>

export type SearchSourceOutcome = Readonly<{
  sourceKey: string
  status: 'complete' | 'partial' | 'unavailable'
  resultCount: number
  errorCode?: string
}>

export type PlaceSearchPage = Readonly<{
  schemaVersion: 'place-search.v1'
  items: readonly PlaceSearchResult[]
  nextCursor?: string
  sources: readonly SearchSourceOutcome[]
}>

export class InvalidSearchCursorError extends Error {
  override readonly name = 'InvalidSearchCursorError'
}

export type LocalPlaceSearchDocument = Readonly<{
  placeId: string
  sourceVersion: number
  name: string
  areaLabel: string | null
  latitude: number
  longitude: number
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  taxonomyKeys: readonly string[]
  evidenceStatus: PlaceSearchResult['evidenceStatus']
  projectedAt: string
}>

export type MemberSearchSignal = Readonly<{
  memberId: string
  placeId: string
  sourceVersion: number
  saved: boolean
  wanted: boolean
  visited: boolean
  personalRating: number | null
  projectedAt: string
}>

export class InvalidLocalSearchProjectionError extends Error {
  override readonly name = 'InvalidLocalSearchProjectionError'
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

export function assertLocalPlaceSearchDocument(document: LocalPlaceSearchDocument): void {
  if (
    document.placeId.length === 0 || !Number.isInteger(document.sourceVersion) ||
    document.sourceVersion < 1 || document.name.trim().length === 0 || document.name.length > 300 ||
    document.latitude < -90 || document.latitude > 90 ||
    document.longitude < -180 || document.longitude > 180 ||
    document.taxonomyKeys.length > 32 || new Set(document.taxonomyKeys).size !== document.taxonomyKeys.length ||
    !validTimestamp(document.projectedAt)
  ) throw new InvalidLocalSearchProjectionError('Local place search projection is invalid.')
}

export function assertMemberSearchSignal(signal: MemberSearchSignal): void {
  const rating = signal.personalRating
  if (
    signal.memberId.length === 0 || signal.placeId.length === 0 ||
    !Number.isInteger(signal.sourceVersion) || signal.sourceVersion < 1 ||
    !validTimestamp(signal.projectedAt) ||
    (rating !== null && (
      rating < 0.1 || rating > 5 || Math.round(rating * 10) !== rating * 10
    ))
  ) throw new InvalidLocalSearchProjectionError('Member search signal is invalid.')
}

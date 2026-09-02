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
  areaReference?: Readonly<{ key: string; version: number }> | null
  latitude: number
  longitude: number
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  taxonomyKeys: readonly string[]
  taxonomyReferences?: readonly Readonly<{
    key: string
    version: number
    kind: 'category' | 'attribute'
  }>[]
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
  const taxonomyReferences = document.taxonomyReferences ?? []
  const taxonomyReferenceIdentities = taxonomyReferences.map(({ key, version }) => `${key}\u0000${version}`)
  const taxonomyReferenceKeys = taxonomyReferences.map(({ key }) => key)
  if (
    document.placeId.length === 0 || !Number.isInteger(document.sourceVersion) ||
    document.sourceVersion < 1 || document.name.trim().length === 0 || document.name.length > 300 ||
    document.latitude < -90 || document.latitude > 90 ||
    document.longitude < -180 || document.longitude > 180 ||
    document.taxonomyKeys.length > 32 || new Set(document.taxonomyKeys).size !== document.taxonomyKeys.length ||
    (document.areaReference !== undefined && document.areaReference !== null && (
      document.areaLabel === null ||
      document.areaReference.key.length < 1 || document.areaReference.key.length > 128 ||
      !Number.isSafeInteger(document.areaReference.version) || document.areaReference.version < 1
    )) ||
    taxonomyReferences.length > 32 ||
    new Set(taxonomyReferenceIdentities).size !== taxonomyReferenceIdentities.length ||
    (taxonomyReferences.length > 0 && (
      taxonomyReferenceKeys.length !== document.taxonomyKeys.length ||
      taxonomyReferenceKeys.some((key) => !document.taxonomyKeys.includes(key)) ||
      document.taxonomyKeys.some((key) => !taxonomyReferenceKeys.includes(key)) ||
      (document.primaryTaxonomy !== null && !taxonomyReferences.some((reference) => (
        reference.kind === 'category' && reference.key === document.primaryTaxonomy?.key
      )))
    )) ||
    taxonomyReferences.some(({ key, version }) => (
      key.length < 1 || key.length > 128 || !Number.isSafeInteger(version) || version < 1
    )) ||
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

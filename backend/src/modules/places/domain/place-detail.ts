export type PlaceDetailDocument = Readonly<{
  placeId: string
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }>
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  taxonomyKeys: readonly string[]
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
  projectedAt: string
}>

export type PlaceDetailVisitSummary =
  | Readonly<{ visited: false; count: 0 }>
  | Readonly<{
      visited: true
      count: number
      firstVisitedAt: string
      lastVisitedAt: string
    }>

export type PlaceDetailPersonalSource = Readonly<{
  preferences?: Readonly<{
    saved: boolean
    wanted: boolean
    personalRating: number | null
    updatedAt: string
  }>
  visits: PlaceDetailVisitSummary
}>

type PlaceDetailIdentity = Readonly<{
  schemaVersion: 'place-detail.v1'
  requestedPlaceId: string
  placeId: string
  redirectedFrom: readonly string[]
}>

type PlaceDetailPersonalState = Readonly<{
  saved: boolean
  wanted: boolean
  personalRating: number | null
  preferencesUpdatedAt: string | null
  visits: PlaceDetailVisitSummary
}>

type AvailablePlaceDetail = PlaceDetailIdentity & Readonly<{
  status: 'available' | 'redirected'
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }>
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  taxonomyKeys: readonly string[]
  evidence: Readonly<{
    status: PlaceDetailDocument['evidenceStatus']
    projectedAt: string
  }>
  personalState?: PlaceDetailPersonalState
}>

type PendingPlaceDetail = PlaceDetailIdentity & Readonly<{
  status: 'pending'
  personalState: PlaceDetailPersonalState
}>

export type PlaceDetail = AvailablePlaceDetail | PendingPlaceDetail

export type PlaceDetailReadResult =
  | Readonly<{ status: 'found'; detail: PlaceDetail }>
  | Readonly<{ status: 'not-found' }>
  | Readonly<{ status: 'retired'; placeId: string }>
  | Readonly<{ status: 'unavailable'; placeId: string }>

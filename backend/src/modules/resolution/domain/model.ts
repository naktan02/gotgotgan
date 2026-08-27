export type GeoPoint = Readonly<{ latitude: number; longitude: number }>

export type ProviderPlaceIdentity = Readonly<{
  providerKey: string
  externalPlaceId: string
}>

export type PlaceEvidenceName = Readonly<{
  text: string
  languageTag?: string
}>

export type PlaceIdentityEvidence = Readonly<{
  sourceObservationId: string
  providerIdentity: ProviderPlaceIdentity
  observedAt: string
  names: readonly PlaceEvidenceName[]
  address?: string | null
  phone?: string | null
  website?: string | null
  category?: string | null
  branch?: string | null
  floor?: string | null
  location?: GeoPoint | null
}>

export type TextScript = 'hangul' | 'latin' | 'han' | 'kana' | 'other'

export type NormalizedNameRepresentation = Readonly<{
  rawText: string
  languageTag: string | null
  normalizedText: string
  scripts: readonly TextScript[]
}>

export type NormalizedPlaceIdentityEvidence = Readonly<{
  sourceObservationId: string
  providerIdentity: ProviderPlaceIdentity
  observedAt: string
  names: readonly NormalizedNameRepresentation[]
  normalizedNameSearch: string
  address: string | null
  normalizedAddress: string | null
  phone: string | null
  phoneDigits: string | null
  website: string | null
  websiteHost: string | null
  category: string | null
  categoryKey: string | null
  branch: string | null
  branchKey: string | null
  floor: string | null
  floorKey: string | null
  location: GeoPoint | null
  fingerprint: string
}>

export type MatchClassification = 'likely-same' | 'needs-review' | 'likely-different'

export type MatchReason =
  | 'cross-script-name'
  | 'exact-phone'
  | 'exact-website-host'
  | 'nearby-location'
  | 'similar-name'
  | 'similar-address'
  | 'same-category'
  | 'different-branch'
  | 'different-floor'
  | 'far-apart-concurrent-observations'
  | 'insufficient-evidence'

export type MatchFeatureVector = Readonly<{
  distanceMeters: number | null
  nameSimilarity: number | null
  addressSimilarity: number | null
  phoneExact: boolean | null
  websiteHostExact: boolean | null
  categoryExact: boolean | null
  branchRelation: 'same' | 'different' | 'unknown'
  floorRelation: 'same' | 'different' | 'unknown'
  observationGapDays: number
}>

export type MatchAssessment = Readonly<{
  leftObservationId: string
  rightObservationId: string
  leftIdentity: ProviderPlaceIdentity
  rightIdentity: ProviderPlaceIdentity
  policyVersion: string
  classification: MatchClassification
  confidence: number
  features: MatchFeatureVector
  reasons: readonly MatchReason[]
  assessedAt: string
  fingerprint: string
}>

export class InvalidPlaceEvidenceError extends Error {
  override readonly name = 'InvalidPlaceEvidenceError'
}

export class PlaceEvidenceConflictError extends Error {
  override readonly name = 'PlaceEvidenceConflictError'
}

export class MatchAssessmentConflictError extends Error {
  override readonly name = 'MatchAssessmentConflictError'
}

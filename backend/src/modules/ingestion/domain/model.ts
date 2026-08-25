export const acquisitionKinds = [
  'documented-api',
  'account-export',
  'structured-web',
  'browser-network',
  'browser-dom',
  'manual-capture',
] as const
export type AcquisitionKind = (typeof acquisitionKinds)[number]

export type GeoPoint = Readonly<{ latitude: number; longitude: number }>

export type SourceObservationRecord = Readonly<{
  kind: 'source-observation'
  id: string
  providerKey: string
  externalPlaceId: string
  acquisitionKind: AcquisitionKind
  payloadChecksum: string
  parserVersion: string
  observedAt: string
  acquiredAt: string
  captureReference?: string
  facts: Readonly<Record<string, unknown>>
  confidence: number
  fingerprint: string
}>

export type PlaceCandidateRecord = Readonly<{
  kind: 'place-candidate'
  id: string
  sourceObservationId: string
  parserVersion: string
  name: string
  address?: string
  location?: GeoPoint
  attributes: Readonly<Record<string, unknown>>
  createdAt: string
  fingerprint: string
}>

export type ResolutionDecision =
  | Readonly<{ kind: 'needs-review' }>
  | Readonly<{ kind: 'explicit-not-same'; comparedCanonicalPlaceId: string }>
  | Readonly<{ kind: 'create-place'; canonicalPlaceId: string }>
  | Readonly<{ kind: 'link-place'; canonicalPlaceId: string }>
  | Readonly<{
      kind: 'merge-places'
      sourceCanonicalPlaceId: string
      targetCanonicalPlaceId: string
    }>
  | Readonly<{
      kind: 'split-provider-identity'
      sourceCanonicalPlaceId: string
      newCanonicalPlaceId: string
      providerIdentity: Readonly<{ providerKey: string; externalPlaceId: string }>
    }>
  | Readonly<{ kind: 'retire-place'; canonicalPlaceId: string }>

export type ResolutionDecisionRecord = Readonly<{
  kind: 'resolution-decision'
  id: string
  candidateId?: string
  decision: ResolutionDecision
  decidedBy: Readonly<{ kind: 'policy' | 'reviewer'; reference: string }>
  evidenceObservationIds: readonly string[]
  rationale: string
  decidedAt: string
  fingerprint: string
}>

export type IngestionRecord =
  | SourceObservationRecord
  | PlaceCandidateRecord
  | ResolutionDecisionRecord

export class InvalidIngestionRecordError extends Error {
  override readonly name = 'InvalidIngestionRecordError'
}

export class IngestionIdConflictError extends Error {
  override readonly name = 'IngestionIdConflictError'
}

export function assertProviderKey(value: string): void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value)) {
    throw new InvalidIngestionRecordError('providerKey must be a stable lowercase identifier')
  }
}

export function assertGeoPoint(value: GeoPoint | undefined): void {
  if (value === undefined) return
  if (
    !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90 ||
    !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180
  ) {
    throw new InvalidIngestionRecordError('location must contain valid WGS84 coordinates')
  }
}

export function assertIsoTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidIngestionRecordError(`${field} must be an ISO timestamp`)
  }
}

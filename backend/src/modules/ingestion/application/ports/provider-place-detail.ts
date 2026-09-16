import type { AcquisitionKind, GeoPoint } from '../../domain/model.js'

export type ProviderDetailFailureCode =
  | 'provider-rate-limited'
  | 'provider-unavailable'
  | 'provider-interaction-required'
  | 'provider-parser-drift'
  | 'capture-invalid'

export type ProviderPlaceDetailSnapshot = Readonly<{
  acquisitionKind: AcquisitionKind
  payloadChecksum: string
  parserVersion: string
  observedAt: string
  captureReference?: string
  name: string
  address: string | null
  categoryLabel: string | null
  location: GeoPoint | null
  attributes: Readonly<Record<string, unknown>>
  confidence: number
}>

export type ProviderPlaceDetailResult =
  | Readonly<{ kind: 'available'; detail: ProviderPlaceDetailSnapshot }>
  | Readonly<{
      kind: 'failure'
      code: ProviderDetailFailureCode
      retryable: boolean
    }>

export interface ProviderPlaceDetailSource {
  readonly providerKey: 'naver' | 'kakao' | 'google'
  fetch(input: Readonly<{
    providerPlaceId: string
    signal: AbortSignal
  }>): Promise<ProviderPlaceDetailResult>
}

export type ProviderPlaceDetailClaim = Readonly<{
  jobId: string
  providerKey: 'naver' | 'kakao' | 'google'
  providerPlaceId: string
  attemptCount: number
  observationId: string
  candidateId: string
  lease: Readonly<{ owner: string; generation: number; expiresAt: string }>
}>

export interface ProviderPlaceDetailJobStore {
  scheduleStale(input: Readonly<{
    providerKeys: readonly ProviderPlaceDetailClaim['providerKey'][]
    staleBefore: string
    scheduledAt: string
    limit: number
  }>): Promise<number>
  claimNext(input: Readonly<{
    workerId: string
    providerKeys: readonly ProviderPlaceDetailClaim['providerKey'][]
    claimedAt: string
    leaseUntil: string
  }>): Promise<ProviderPlaceDetailClaim | undefined>
  renewLease(input: Readonly<{
    claim: ProviderPlaceDetailClaim
    renewedAt: string
    leaseUntil: string
  }>): Promise<boolean>
  complete(input: Readonly<{
    claim: ProviderPlaceDetailClaim
    completedAt: string
  }>): Promise<void>
  finishFailure(input: Readonly<{
    claim: ProviderPlaceDetailClaim
    code: ProviderDetailFailureCode
    retryable: boolean
    retryAt?: string
    finishedAt: string
  }>): Promise<void>
}

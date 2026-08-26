import type { ImportFailureCode } from '../../domain/imports.js'
import type { ReviewableImportItem } from './import-review-store.js'
import type { EnrichedPlaceDetail } from './place-enrichment-source.js'

export type FulfillableImportItem = Omit<ReviewableImportItem, 'providerPlaceId'> & Readonly<{
  providerPlaceId: string
}>

export type ImportedPlaceFulfillmentClaim = Readonly<{
  jobId: string
  providerKey: 'naver' | 'kakao' | 'google'
  providerPlaceId: string
  attemptCount: number
  observationId: string
  candidateId: string
  decisionId: string
  proposedPlaceId: string
  lease: Readonly<{ owner: string; generation: number; expiresAt: string }>
  items: readonly FulfillableImportItem[]
}>

export type ImportedPlaceFulfillmentOutcome =
  | Readonly<{ kind: 'completed'; canonicalPlaceId: string }>
  | Readonly<{ kind: 'needs-review'; detail: EnrichedPlaceDetail }>
  | Readonly<{
      kind: 'failure'
      code: Extract<
        ImportFailureCode,
        'provider-rate-limited' | 'provider-unavailable' | 'provider-parser-drift' | 'capture-invalid'
      >
      retryable: boolean
      retryAt?: string
    }>

export interface ImportedPlaceFulfillmentStore {
  claimNextFulfillment(input: Readonly<{
    workerId: string
    claimedAt: string
    leaseUntil: string
  }>): Promise<ImportedPlaceFulfillmentClaim | undefined>
  renewFulfillmentLease(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    renewedAt: string
    leaseUntil: string
  }>): Promise<boolean>
  completeFulfillmentItems(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    itemIds: readonly string[]
    canonicalPlaceId: string
    completedAt: string
  }>): Promise<void>
  finishFulfillmentJob(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    outcome: ImportedPlaceFulfillmentOutcome
    finishedAt: string
  }>): Promise<void>
}

import type { ConnectedPlaceItem, ProviderConnectionHandle } from './connected-place-source.js'
import type { ImportFailureCode } from '../../domain/imports.js'

export type ImportClaim = Readonly<{
  jobId: string
  batchId: string
  memberId: string
  connection: ProviderConnectionHandle
  attemptCount: number
  cursor: string | null
  lease: Readonly<{ owner: string; generation: number; expiresAt: string }>
  cancellationRequestedAt: string | null
}>

export type PreparedImportItem = ConnectedPlaceItem & Readonly<{
  itemId: string
  observationId: string
  candidateId: string
  decisionId: string
  proposedPlaceId: string
  fulfillment?: Readonly<{
    jobId: string
    observationId: string
    candidateId: string
    decisionId: string
    proposedPlaceId: string
  }>
  detail?: Readonly<{
    jobId: string
    observationId: string
    candidateId: string
  }>
}>

export type ImportAttemptOutcome =
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'needs-user-action'; code: ImportFailureCode }>
  | Readonly<{
      kind: 'failure'
      code: ImportFailureCode
      retryable: boolean
      retryAt?: string
    }>

export interface ImportWorkerStore {
  claimNext(input: Readonly<{
    workerId: string
    claimedAt: string
    leaseUntil: string
  }>): Promise<ImportClaim | undefined>
  renewLease(input: Readonly<{
    claim: ImportClaim
    renewedAt: string
    leaseUntil: string
  }>): Promise<boolean>
  recordPage(input: Readonly<{
    claim: ImportClaim
    capture: Readonly<{
      artifactId: string
      reference: string
      checksum: string
      parserVersion: string
      acquisitionKind: string
      observedAt: string
      retentionUntil: string
    }>
    items: readonly PreparedImportItem[]
    nextCursor: string | null
    recordedAt: string
  }>): Promise<Readonly<{
    status: 'queued' | 'enriching' | 'needs-review' | 'completed' | 'cancelled'
  }>>
  finishAttempt(input: Readonly<{
    claim: ImportClaim
    outcome: ImportAttemptOutcome
    finishedAt: string
  }>): Promise<void>
}

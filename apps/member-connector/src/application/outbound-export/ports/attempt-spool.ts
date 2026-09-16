import type { SavedPlaceTargetAddItem } from './saved-place-target.js'

/**
 * Durable, local write-ahead record. A Provider adapter receives the correlation identifiers as
 * execution context, but must never serialize them into a Provider request or log.
 */
export type OutboundAttemptSeal = Readonly<{
  schemaVersion: 'outbound-attempt-seal.v1'
  operationId: string
  receiptReference: string
  attemptId: string
  phase: 'create-target-list' | 'add-items'
  targetListId: string | null
  sequence: number
  final: boolean
  requestFingerprint: string
  planDigest: string
  reconciliationReference: string
  items: readonly SavedPlaceTargetAddItem[]
  sealedAt: string
  writeExpiresAt: string
  reconciliationExpiresAt: string
}>

export type OutboundAttemptSpoolEntry = Readonly<{
  attempt: OutboundAttemptSeal
  state: 'sealed' | 'prepared' | 'reported' | 'completed'
  updatedAt: string
  retainUntil: string | null
}>

/**
 * Implementations must persist and fsync the exact record before returning `sealed`. `replayed`
 * means the record already existed and therefore the earlier Provider-call outcome is unknown;
 * callers must reconcile instead of issuing the write again.
 */
export interface OutboundAttemptSpool {
  seal(attempt: OutboundAttemptSeal): Promise<'sealed' | 'replayed' | 'conflict'>

  /**
   * Bounded recovery scan, oldest update first. Implementations return at most `limit`, never
   * duplicate an attempt, and exclude completed audit records.
   */
  listPending(input: Readonly<{
    limit: number
  }>): Promise<readonly OutboundAttemptSpoolEntry[]>

  load(attemptId: string): Promise<OutboundAttemptSpoolEntry | null>

  /** Atomic `sealed -> prepared`; identical repeats return `replayed`. */
  acknowledgePrepared(input: Readonly<{
    attemptId: string
    preparedAt: string
  }>): Promise<'acknowledged' | 'replayed' | 'conflict' | 'not-found'>

  /** Atomic `prepared -> reported`; identical repeats return `replayed`. */
  acknowledgeReported(input: Readonly<{
    attemptId: string
    reportedAt: string
  }>): Promise<'acknowledged' | 'replayed' | 'conflict' | 'not-found'>

  /**
   * Atomic `reported -> completed`, making the record immutable audit history. `retainUntil` must
   * cover the reconciliation window; removal before it is forbidden even after Backend acknowledgement.
   */
  complete(input: Readonly<{
    attemptId: string
    completedAt: string
    retainUntil: string
  }>): Promise<'completed' | 'replayed' | 'conflict' | 'not-found'>

  remove(input: Readonly<{
    attemptId: string
    now: string
  }>): Promise<'removed' | 'retained' | 'not-found'>
}

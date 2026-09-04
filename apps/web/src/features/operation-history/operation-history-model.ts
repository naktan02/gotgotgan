export type OperationProviderKey = 'naver' | 'google' | 'kakao'

export type OperationKind =
  | 'import-capture'
  | 'import-materialization'
  | 'outbound-transfer'
  | 'account-erasure'
export type OperationState =
  | 'queued'
  | 'running'
  | 'retry-scheduled'
  | 'action-required'
  | 'partial-failure'
  | 'outcome-unknown'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type OperationAction = 'retry' | 'resume' | 'cancel' | 'reconcile'

export type OperationProgress = Readonly<{
  total: number
  processed: number
  applied: number
  failed: number
  outcomeUnknown: number
}>

export type OperationSummary = Readonly<{
  operationId: string
  operationRevision: string
  kind: OperationKind
  providerKey: OperationProviderKey | null
  providerLabel: string
  accountLabel: string | null
  title: string
  state: OperationState
  stage: string
  progress: OperationProgress
  attemptCount: number
  nextAttemptAt: string | null
  actionRequired:
    | 'reauth-required'
    | 'mfa-required'
    | 'captcha-required'
    | 'consent-required'
    | 'retention-review-required'
    | 'operator-approval-required'
    | null
  lastError: Readonly<{ code: string; retryable: boolean }> | null
  allowedActions: readonly OperationAction[]
  createdAt: string
  updatedAt: string
  completedAt: string | null
}>

export type OperationItemReceipt = Readonly<{
  itemId: string
  label: string
  targetReference: string | null
  state: 'pending' | 'applied' | 'already-present' | 'failed' | 'outcome-unknown' | 'present' | 'absent' | 'skipped'
  reason: string | null
  retryable: boolean | null
  occurredAt: string | null
}>

export type OperationDetail = OperationSummary

export type OperationFilters = Readonly<{
  state: '' | OperationState
  kind: '' | OperationKind
}>

export type OperationHistoryPage = Readonly<{
  items: readonly OperationSummary[]
  nextCursor?: string
}>

export type OperationItemPage = Readonly<{
  items: readonly OperationItemReceipt[]
  nextCursor?: string
}>

export type OperationIndicator = Readonly<{
  activeCount: number
  attentionCount: number
  actionRequiredCount: number
  outcomeUnknownCount: number
  latest: readonly OperationSummary[]
}>

export type OperationCommandResult = Readonly<{
  operation: OperationDetail
}>

export type OperationHistoryGateway = Readonly<{
  list(filters: OperationFilters, cursor?: string, signal?: AbortSignal): Promise<OperationHistoryPage>
  detail(operationId: string, signal?: AbortSignal): Promise<OperationDetail>
  items(operationId: string, cursor?: string, signal?: AbortSignal): Promise<OperationItemPage>
  command(input: Readonly<{
    commandId: string
    operationId: string
    expectedOperationRevision: string
    action: OperationAction
  }>, signal?: AbortSignal): Promise<OperationCommandResult>
}>

export class OperationHistoryProblem extends Error {
  override readonly name = 'OperationHistoryProblem'

  constructor(readonly status: number, readonly code?: string) {
    super(`Operation history request failed with ${status}`)
  }
}

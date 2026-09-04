import type { ProviderKey, TransferCommandResult } from './model.js'

export class ConnectorTransferAuthorizationError extends Error {
  override readonly name = 'ConnectorTransferAuthorizationError'
}

export type TransferOperationKind =
  | 'import-capture' | 'import-materialization' | 'outbound-transfer' | 'account-erasure'
export type TransferOperationState =
  | 'queued' | 'running' | 'retry-scheduled' | 'action-required' | 'partial-failure'
  | 'outcome-unknown' | 'completed' | 'cancelled' | 'failed'
export type TransferOperationStage =
  | 'awaiting-connector' | 'receiving-chunks' | 'validating-manifest' | 'snapshot-recorded'
  | 'preview-approved' | 'queued-for-materialization' | 'materializing'
  | 'library-completed' | 'authorizing-execution' | 'executing-provider-write'
  | 'reconciling' | 'externally-completed' | 'retention-review' | 'purging'
  | 'erasure-completed'
export type TransferOperationAction = 'retry' | 'resume' | 'cancel' | 'reconcile'

export type TransferOperation = Readonly<{
  schemaVersion: 'transfer-operation.v2'
  operationId: string
  kind: TransferOperationKind
  providerKey: ProviderKey | null
  connectionId: string | null
  accountLabel: string | null
  resource:
    | Readonly<{ kind: 'snapshot'; snapshotId: string }>
    | Readonly<{ kind: 'import-plan'; planId: string }>
    | Readonly<{ kind: 'outbound-transfer'; transferId: string }>
    | Readonly<{ kind: 'membership-erasure' }>
  stage: TransferOperationStage
  state: TransferOperationState
  progress: Readonly<{
    total: number; processed: number; applied: number; failed: number; outcomeUnknown: number
  }>
  operationRevision: string
  attemptCount: number
  nextAttemptAt: string | null
  actionRequired:
    | 'reauth-required' | 'mfa-required' | 'captcha-required' | 'consent-required'
    | 'retention-review-required' | 'operator-approval-required' | null
  allowedActions: readonly TransferOperationAction[]
  lastError: Readonly<{ code: string; retryable: boolean }> | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}>

export type TransferOperationItem = Readonly<{
  itemKey: string
  placeId: string | null
  targetReference: string | null
  status: 'pending' | 'applied' | 'already-present' | 'failed' | 'outcome-unknown'
    | 'present' | 'absent' | 'skipped'
  code: string | null
  retryable: boolean | null
  updatedAt: string
}>

export type TransferOperationCommand = Readonly<{
  commandId: string
  operationId: string
  expectedOperationRevision: string
  action: TransferOperationAction
}>

export type AccountErasureReviewPlan = Readonly<{
  physicalDeletionPerformed: false
  retentionDisposition: 'operator-review-required'
  recordCounts: Readonly<{
    providerConnections: number; sourceSnapshots: number; importPlans: number
    outboundTransfers: number; transferOperations: number
  }>
}>

export interface TransferOperationQueries {
  list(input: Readonly<{
    memberId: string; kind?: TransferOperationKind; state?: TransferOperationState
    cursor?: string; limit: number
  }>): Promise<Readonly<{ items: readonly TransferOperation[]; nextCursor?: string }>>
  summary(memberId: string): Promise<Readonly<{
    activeCount: number; attentionCount: number; actionRequiredCount: number; outcomeUnknownCount: number
    latest: readonly TransferOperation[]
  }>>
  get(memberId: string, operationId: string): Promise<TransferOperation | undefined>
  items(input: Readonly<{ memberId: string; operationId: string; cursor?: string; limit: number }> ):
    Promise<Readonly<{ items: readonly TransferOperationItem[]; nextCursor?: string }> | undefined>
  command(memberId: string, command: TransferOperationCommand):
    Promise<TransferCommandResult<TransferOperation>>
  planAccountErasure(memberId: string, commandId: string): Promise<
    TransferCommandResult<Readonly<{ operation: TransferOperation; plan: AccountErasureReviewPlan }>>
  >
}

export type ConnectorManifest = Readonly<{
  manifestId: string; manifestDigest: string; sourceRevision: string
  provenance?: Readonly<{
    acquisitionKind: 'documented-api' | 'account-export' | 'structured-web' |
      'browser-network' | 'browser-dom' | 'manual-capture'
    parserVersion: string
  }> | undefined
  observedAt: string; capturedAt: string; chunkCount: number; listCount: number
  itemCount: number; byteCount: number
}>

export type ConnectorCapturePayload = Readonly<{
  lists: readonly Readonly<{
    sourceListId: string; observedName: string; sourcePosition: number
    items: readonly Readonly<{
      sourceItemId: string; providerPlaceId: string | null; observedName: string
      observedAddress: string | null; observedCategory: string | null
      observedLocation: Readonly<{ latitude: number; longitude: number }> | null
      sourcePosition: number
    }>[]
  }>[]
}>

export type ConnectorImportGrantRequest = Readonly<{
  commandId: string; operationId: string; connectionId: string
  expectedConnectionRevision: string; providerKey: ProviderKey; accountFingerprint: string
  installationId: string; placeOrigin: string; manifest: ConnectorManifest
}>

export type ConnectorImportGrant = Readonly<{
  grantId: string; operationId: string; connectionId: string; providerKey: ProviderKey
  accountFingerprint: string; installationId: string; token: string; placeOrigin: string
  manifest: ConnectorManifest; issuedAt: string; expiresAt: string
  limits: Readonly<{
    maximumChunks: number; maximumItems: number; maximumBytes: number; maximumChunkBytes: number
  }>
}>

export interface ConnectorTransferReceiver {
  issueImportGrant(memberId: string, request: ConnectorImportGrantRequest): Promise<
    TransferCommandResult<ConnectorImportGrant>
  >
  recordChunk(input: Readonly<{ token: string; sourceOrigin: string; chunk: Readonly<{
    operationId: string; manifestId: string; sequence: number; itemCount: number
    byteCount: number; checksum: string; payload: string
  }> }>): Promise<Readonly<{
    outcome: 'recorded' | 'replayed'; operationId: string; manifestId: string
    acceptedSequence: number; nextSequence: number; receivedChunks: number
    receivedItems: number; receivedBytes: number
  }>>
  status(input: Readonly<{ token: string; sourceOrigin: string; operationId: string; manifestId: string }> ):
    Promise<Readonly<{
      operationId: string; manifestId: string; state: 'receiving' | 'completed' | 'cancelled' | 'expired'
      recordedSequences: readonly number[]; nextSequence: number
      snapshotId: string | null; snapshotVersion: string | null
    }>>
  complete(input: Readonly<{
    token: string; sourceOrigin: string; operationId: string; manifest: ConnectorManifest
  }>): Promise<Readonly<{
    outcome: 'completed' | 'replayed' | 'incomplete'; operationId: string; manifestId: string
    missingSequences: readonly number[]; snapshotId: string | null; snapshotVersion: string | null
  }>>
}

export type OutboundExecutionManifest = Readonly<{
  operationId: string; transferId: string; connectionId: string; providerKey: ProviderKey
  accountFingerprint: string; collectionId: string; collectionRevision: string
  targetObservationRevision: string
  target: Readonly<{ kind: 'new-list'; name: string }> |
    Readonly<{ kind: 'existing-list'; targetListId: string }>
  planDigest: string
  items: readonly Readonly<{
    itemKey: string; placeId: string; targetProviderPlaceId: string
    action: 'add' | 'already-present'; sourcePosition: number
  }>[]
}>

export type OutboundExecutionGrant = Readonly<{
  grantId: string; operationId: string; transferId: string; connectionId: string
  providerKey: ProviderKey; accountFingerprint: string; installationId: string
  planDigest: string; token: string; placeOrigin: string; issuedAt: string; expiresAt: string
  limits: Readonly<{ maximumItems: number; maximumBytes: number; maximumBatches: number }>
  manifest: OutboundExecutionManifest
}>

export type OutboundExecutionAttempt = Readonly<{
  operationId: string; receiptReference: string; attemptId: string
  phase: 'create-target-list' | 'add-items'; targetListId: string | null
  sequence: number; final: boolean; outcome: 'completed' | 'partial' | 'outcome-unknown'
  reconciliationReference: string | null
  problem?: Readonly<{
    code: string; retryable: boolean
    actionRequired: 'reauth-required' | 'mfa-required' | 'captcha-required' | 'consent-required' | null
  }> | null
  items: readonly Readonly<{
    itemKey: string; targetReference: string | null
    status: 'applied' | 'already-present' | 'failed' | 'outcome-unknown'
    code: string | null; retryable: boolean | null; reconciliationReference: string | null
  }>[]
}>

export type OutboundExecutionAttemptIntent = Readonly<{
  operationId: string; receiptReference: string; attemptId: string
  phase: 'create-target-list' | 'add-items'; targetListId: string | null
  sequence: number; final: boolean; reconciliationReference: string
  items: readonly Readonly<{ itemKey: string; targetReference: string }>[]
}>

type OutboundExecutionReconciliation = Readonly<{
  reconciliationId: string; operationId: string; receiptReference: string; attemptId: string
  reconciliationReference: string
  items: readonly Readonly<{
    itemKey: string; status: 'present' | 'absent' | 'unknown'; targetReference: string | null
  }>[]
}> & (
  Readonly<{
    phase: 'create-target-list'; targetListId: string | null
    outcome: 'resolved-completed' | 'still-unknown'
  }> |
  Readonly<{
    phase: 'add-items'; targetListId: string | null
    outcome: 'resolved-completed' | 'resolved-partial' | 'still-unknown'
  }>
)

export interface OutboundExecutionControl {
  issueGrant(memberId: string, request: Readonly<{
    commandId: string; transferId: string; expectedTransferRevision: string
    installationId: string; accountFingerprint: string; placeOrigin: string
  }>): Promise<TransferCommandResult<OutboundExecutionGrant>>
  consume(input: Readonly<{ token: string; request: Readonly<{
    grantId: string; operationId: string; connectionId: string; providerKey: ProviderKey
    accountFingerprint: string; installationId: string; planDigest: string; sourceOrigin: string
    itemCount: number; byteCount: number; batchCount: number; batchSize: number
  }> }>): Promise<Readonly<{
    status: 'consumed' | 'replayed'; grantId: string; receiptReference: string
    receiptToken: string; operationId: string; transferId: string; connectionId: string
    providerKey: ProviderKey; accountFingerprint: string; installationId: string
    planDigest: string; batchSize: number; authorizedAt: string; expiresAt: string
    reconciliationExpiresAt: string
    limits: Readonly<{ maximumItems: number; maximumBytes: number; maximumBatches: number }>
  }>>
  prepareAttempt(input: Readonly<{
    receiptToken: string; sourceOrigin: string; intent: OutboundExecutionAttemptIntent
  }>): Promise<Readonly<{
    outcome: 'recorded' | 'replayed'; operationId: string; attemptId: string
  }>>
  recordAttempt(input: Readonly<{ receiptToken: string; sourceOrigin: string; attempt: OutboundExecutionAttempt }> ):
    Promise<Readonly<{ outcome: 'recorded' | 'replayed'; operation: TransferOperation }>>
  recordReconciliation(input: Readonly<{
    receiptToken: string; sourceOrigin: string
    reconciliation: OutboundExecutionReconciliation
  }>): Promise<Readonly<{ outcome: 'recorded' | 'replayed'; operation: TransferOperation }>>
}

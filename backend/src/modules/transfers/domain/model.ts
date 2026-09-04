export type ProviderKey = 'naver' | 'kakao' | 'google'
export type ProviderAuthMethod =
  | 'browser-session' | 'managed-profile' | 'oauth' | 'account-export' | 'manual-file'
export type TransferAvailability = 'available' | 'integration-gated' | 'unavailable'
export type TransferCommandRejectionCodeV2 =
  | 'not-found' | 'command-id-reused' | 'revision-conflict' | 'snapshot-changed'
  | 'collection-changed' | 'target-observation-changed' | 'invalid-selection'
  | 'connection-not-ready' | 'target-unavailable' | 'not-approvable'

export class InvalidTransferCursorError extends Error {
  override readonly name = 'InvalidTransferCursorError'
}

export type ProviderCapabilityV2 = Readonly<{
  providerKey: ProviderKey
  displayName: string
  connections: Readonly<{
    availability: TransferAvailability
    multipleAccounts: true
    authMethods: readonly ProviderAuthMethod[]
  }>
  importSavedPlaces: Readonly<{
    availability: TransferAvailability
    reason?: 'source-adapter-unavailable'
  }>
  exportCollections: Readonly<{
    availability: TransferAvailability
    reason?: 'target-adapter-unavailable'
  }>
}>

export type ProviderConnectionV2 = Readonly<{
  schemaVersion: 'provider-connection.v2'
  connectionId: string
  providerKey: ProviderKey
  label: string
  authMethod: ProviderAuthMethod
  state: 'action-required' | 'ready' | 'revoked'
  connectionRevision: string
  lastVerifiedAt: string | null
  actionRequired: 'complete-authorization' | 'reauthorize' | null
  createdAt: string
  updatedAt: string
}>

type CommandBase = Readonly<{ schemaVersion: string; commandId: string }>
export type ProviderConnectionCommandRequestV2 =
  | (CommandBase & Readonly<{
      kind: 'create'; connectionId: string; providerKey: ProviderKey
      label: string; authMethod: ProviderAuthMethod
    }>)
  | (CommandBase & Readonly<{
      kind: 'rename'; connectionId: string; expectedConnectionRevision: string; label: string
    }>)
  | (CommandBase & Readonly<{
      kind: 'request-reauthorization' | 'revoke'; connectionId: string
      expectedConnectionRevision: string
    }>)

export type SnapshotItem = Readonly<{
  sourceItemId: string
  providerPlaceId: string | null
  observedName: string
  observedAddress: string | null
  observedCategory: string | null
  observedLocation: Readonly<{ latitude: number; longitude: number }> | null
  match: Readonly<{ status: 'matched'; placeId: string }> |
    Readonly<{ status: 'unresolved'; reason: 'missing-identity' | 'ambiguous' | 'retired' }>
  sourcePosition: number
}>
export type SnapshotList = Readonly<{
  sourceListId: string; observedName: string; sourcePosition: number
  itemCount: number; unresolvedItemCount: number; items: readonly SnapshotItem[]
}>
export type SourceSnapshotDetailV2 = Readonly<{
  schemaVersion: 'source-snapshot-detail.v2'; snapshotId: string; snapshotVersion: string
  connectionId: string; providerKey: ProviderKey; sourceRevision: string
  listCount: number; itemCount: number; unresolvedItemCount: number
  observedAt: string; capturedAt: string; lists: readonly SnapshotList[]
}>
export type SourceSnapshotListV2 = Readonly<{
  schemaVersion: 'source-snapshot-list.v2'
  items: readonly Omit<SourceSnapshotDetailV2, 'schemaVersion' | 'lists'>[]
  nextCursor?: string
}>

export type ImportPlanTarget =
  | Readonly<{ kind: 'new'; collectionId: string; name: string }>
  | Readonly<{ kind: 'existing'; collectionId: string; expectedCollectionRevision: string }>
export type ImportPlanCommandRequestV2 =
  | (CommandBase & Readonly<{
      kind: 'create'; planId: string; snapshotId: string; expectedSnapshotVersion: string
      mappings: readonly Readonly<{ sourceListId: string; target: ImportPlanTarget }>[]
    }>)
  | (CommandBase & Readonly<{
      kind: 'decide-item'; planId: string; expectedPlanRevision: string
      sourceListId: string; sourceItemId: string
      decision: Readonly<{ kind: 'link'; placeId: string }> | Readonly<{ kind: 'skip' }>
    }>)
  | (CommandBase & Readonly<{
      kind: 'approve'; planId: string; expectedPlanRevision: string
    }>)
export type ImportPlanV2 = Readonly<{
  schemaVersion: 'import-plan.v2'; planId: string; planRevision: string
  snapshotId: string; snapshotVersion: string; providerKey: ProviderKey; connectionId: string
  state: 'draft' | 'applying' | 'completed' | 'blocked' | 'cancelled'
  approval: Readonly<{
    eligible: boolean
    reason: 'unresolved-places' | 'already-decided' | 'materialization-rejected' | null
  }>
  mappings: readonly Readonly<{
    sourceListId: string; observedName: string; sourcePosition: number; target: ImportPlanTarget
    itemCount: number; unresolvedItemCount: number
    preview: Readonly<{
      addCount: number; alreadyPresentCount: number; unresolvedCount: number; skippedCount: number
      items: readonly Readonly<{
        sourceItemId: string; providerPlaceId: string | null; observedName: string
        observedAddress: string | null; placeId: string | null
        status: 'add' | 'already-present' | 'unresolved' | 'skipped'
        decision: 'snapshot-match' | 'link' | 'skip' | 'none'
      }>[]
    }>
    materialization: Readonly<{
      state: 'pending' | 'applied' | 'rejected'
      collectionRevision: string | null; rejectionCode: string | null
    }>
  }>[]
  createdAt: string; updatedAt: string
}>

export type OutboundTarget =
  | Readonly<{ kind: 'new-list'; name: string }>
  | Readonly<{ kind: 'existing-list'; targetListId: string }>
export type OutboundSelection = Readonly<{ kind: 'all' }> |
  Readonly<{ kind: 'places'; placeIds: readonly string[] }>
export type OutboundTransferCommandRequestV2 =
  | (CommandBase & Readonly<{
      kind: 'preview'; transferId: string; connectionId: string; collectionId: string
      expectedCollectionRevision: string; selection: OutboundSelection; target: OutboundTarget
    }>)
  | (CommandBase & Readonly<{
      kind: 'approve'; transferId: string; expectedTransferRevision: string
    }>)
export type OutboundTransferV2 = Readonly<{
  schemaVersion: 'outbound-transfer.v2'; transferId: string; transferRevision: string
  providerKey: ProviderKey; connectionId: string; collectionId: string
  collectionRevision: string; target: OutboundTarget; targetObservationRevision: string | null
  planDigest: string; state: 'draft' | 'blocked' | 'approved' | 'applying' | 'completed' | 'failed' | 'cancelled'
  selection: OutboundSelection; itemCount: number
  preview: Readonly<{
    availability: 'available' | 'unavailable'
    addCount: number | null; alreadyPresentCount: number | null
    unresolvedCount: number | null; unsupportedCount: number | null
    items: readonly Readonly<{
      placeId: string; status: 'add' | 'already-present' | 'unresolved' | 'unsupported' | 'unknown'
      targetProviderPlaceId: string | null
    }>[]
  }>
  approval: Readonly<{
    eligible: boolean
    reason: 'target-adapter-unavailable' | 'connection-not-ready' |
      'preview-has-unresolved-items' | 'already-decided' | 'apply-failed' | null
  }>
  approvalReceipt: Readonly<{ commandId: string; planDigest: string; approvedAt: string }> | null
  createdAt: string; updatedAt: string
}>
export type ProviderTargetListV2 = Readonly<{
  targetListId: string; name: string; itemCount: number | null
}>

export type TransferCommandResult<Value> =
  | Readonly<{ status: 'applied' | 'replayed'; commandId: string; value: Value }>
  | Readonly<{
      status: 'rejected'
      commandId: string
      rejection: Readonly<{ code: TransferCommandRejectionCodeV2 }>
    }>

export type SourceSnapshotCapture = Readonly<{
  snapshotId: string
  ownerMemberId: string
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  sourceRevision: string
  provenance: SourceSnapshotProvenance
  observedAt: string
  capturedAt: string
  lists: readonly Readonly<{
    sourceListId: string
    observedName: string
    sourcePosition: number
    items: readonly Readonly<{
      sourceItemId: string
      providerPlaceId: string | null
      observedName: string
      observedAddress: string | null
      observedCategory: string | null
      observedLocation: Readonly<{ latitude: number; longitude: number }> | null
      match:
        | Readonly<{ status: 'matched'; placeId: string }>
        | Readonly<{ status: 'unresolved'; reason: 'missing-identity' | 'ambiguous' | 'retired' }>
      sourcePosition: number
    }>[]
  }>[]
}>

export type SourceSnapshotProvenance = Readonly<{
  acquisitionKind: 'documented-api' | 'account-export' | 'structured-web' |
    'browser-network' | 'browser-dom' | 'manual-capture'
  parserVersion: string
}>

export type ProviderConnectionObservation = Readonly<{
  observationId: string
  ownerMemberId: string
  connectionId: string
  expectedConnectionRevision: string
  /** Privacy-safe SHA-256 of the provider account identity, never the raw account identifier. */
  accountFingerprint: string
  observedState: 'ready' | 'action-required'
  observedAt: string
}>

export type CollectionTransferSnapshot = Readonly<{
  collectionId: string
  collectionVersion: string
  items: readonly Readonly<{ placeId: string; sourcePosition: number }>[]
}>

export interface CollectionTransferReader {
  read(input: Readonly<{ memberId: string; collectionId: string }> ):
    Promise<CollectionTransferSnapshot | undefined>
  readImportBinding(input: Readonly<{
    memberId: string
    providerKey: ProviderKey
    connectionId: string
    sourceListId: string
  }>): Promise<Readonly<{ collectionId: string; bindingVersion: string }> | undefined>
}

export type ImportedCollectionMaterialization = Readonly<{
  context: Readonly<{ operationId: string; memberId: string; occurredAt: string }>
  source: Readonly<{
    providerKey: string
    connectionId: string
    sourceListId: string
    sourcePosition: number
    observedName: string
  }>
  target:
    | Readonly<{ kind: 'new'; collectionId: string; name: string }>
    | Readonly<{ kind: 'existing'; collectionId: string; expectedVersion: string }>
  expectedBindingVersion?: string
  items: readonly Readonly<{
    sourceItemId: string
    providerPlaceId: string
    placeId: string
    sourcePosition: number
  }>[]
}>

export interface ImportedCollectionMaterializerPort {
  materialize(input: ImportedCollectionMaterialization): Promise<
    | Readonly<{
        status: 'applied' | 'replayed'
        operationId: string
        value: Readonly<{
          collectionId: string
          version: string
          bindingVersion: string
          membershipCount: number
        }>
      }>
    | Readonly<{
        status: 'rejected'
        operationId: string
        rejection: Readonly<{ code: string }>
      }>
  >
}

/** Import acquisition seam. It never doubles as an outbound writer. */
export interface SavedPlaceSource {
  readonly providerKey: 'naver' | 'kakao' | 'google'
  capture(input: Readonly<{ memberId: string; connectionId: string }> ):
    Promise<SourceSnapshotCapture>
}

export type SavedPlaceTargetObservation = Readonly<{
  revision: string
  lists: readonly ProviderTargetListV2[]
}>

export type SavedPlaceTargetPreflight = Readonly<{
  observationRevision: string
  items: readonly Readonly<{
    placeId: string
    status: 'add' | 'already-present' | 'unresolved' | 'unsupported'
    targetProviderPlaceId: string | null
  }>[]
}>

/** Export preview seam. Stage 9 never invokes provider mutation methods. */
export interface SavedPlaceTarget {
  readonly providerKey: 'naver' | 'kakao' | 'google'
  observe(input: Readonly<{ memberId: string; connectionId: string }> ):
    Promise<SavedPlaceTargetObservation>
  preflight(input: Readonly<{
    memberId: string
    connectionId: string
    target: OutboundTransferV2['target']
    items: CollectionTransferSnapshot['items']
  }>): Promise<SavedPlaceTargetPreflight>
}

export interface ProviderTransfers {
  listCapabilities(): Promise<readonly ProviderCapabilityV2[]>
  listConnections(memberId: string): Promise<readonly ProviderConnectionV2[]>
  applyConnectionCommand(
    memberId: string,
    command: ProviderConnectionCommandRequestV2,
  ): Promise<TransferCommandResult<ProviderConnectionV2>>
  listSnapshots(input: Readonly<{
    memberId: string
    connectionId?: string
    cursor?: string
    limit: number
  }>): Promise<SourceSnapshotListV2>
  getSnapshot(memberId: string, snapshotId: string): Promise<SourceSnapshotDetailV2 | undefined>
  applyImportPlanCommand(
    memberId: string,
    command: ImportPlanCommandRequestV2,
  ): Promise<TransferCommandResult<ImportPlanV2>>
  getImportPlan(memberId: string, planId: string): Promise<ImportPlanV2 | undefined>
  listTargetLists(memberId: string, connectionId: string): Promise<Readonly<{
    connectionId: string
    availability: 'available' | 'unavailable'
    reason: 'connection-not-ready' | 'target-adapter-unavailable' | null
    targetObservationRevision: string | null
    items: readonly ProviderTargetListV2[]
  }> | undefined>
  applyOutboundTransferCommand(
    memberId: string,
    command: OutboundTransferCommandRequestV2,
  ): Promise<TransferCommandResult<OutboundTransferV2>>
  getOutboundTransfer(memberId: string, transferId: string):
    Promise<OutboundTransferV2 | undefined>
}

export interface TrustedProviderTransferObservations {
  recordConnectionObservation(input: ProviderConnectionObservation):
    Promise<TransferCommandResult<ProviderConnectionV2>>
  recordSourceSnapshot(input: SourceSnapshotCapture): Promise<Readonly<{
    status: 'applied' | 'replayed'
    snapshot: SourceSnapshotDetailV2
  }>>
}

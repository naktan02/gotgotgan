export type SettingsTab = 'account' | 'connections' | 'import' | 'export' | 'history' | 'profile'
export type TransferProviderKey = 'naver' | 'google' | 'kakao'
export const collectionTargetNameMaximumLength = 120

export function initialCollectionTargetName(value: string): string {
  const truncated = value.trim().slice(0, collectionTargetNameMaximumLength)
  const withoutSplitSurrogate = /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated
  return withoutSplitSurrogate || '새 컬렉션'
}

export function validCollectionTargetName(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= collectionTargetNameMaximumLength
}
export type ProviderConnectionState = 'ready' | 'action-required' | 'revoked' | 'disconnected' | 'unavailable'
export type CapabilityState = 'available' | 'manual-file' | 'integration-gated' | 'unavailable'

export type ProviderCapability = Readonly<{
  providerKey: TransferProviderKey
  label: string
  connectionState: 'available' | 'integration-gated' | 'unavailable'
  authMethods: readonly ('browser-session' | 'managed-profile' | 'oauth' | 'account-export' | 'manual-file')[]
  import: Readonly<{
    state: CapabilityState
    label: string
    reason?: string
    alternative?: string
  }>
  export: Readonly<{
    state: CapabilityState
    label: string
    reason?: string
    alternative?: string
  }>
}>

export type ProviderConnection = Readonly<{
  connectionId: string
  providerKey: TransferProviderKey
  authMethod: 'browser-session' | 'managed-profile' | 'oauth' | 'account-export' | 'manual-file'
  accountLabel: string | null
  state: ProviderConnectionState
  stateReason?: string
  lastVerifiedAt: string | null
  revision: string
}>

export type TransferCollection = Readonly<{
  collectionId: string
  name: string
  placeCount: number
  collectionRevision: string
  places: readonly Readonly<{ placeId: string; name: string }>[]
}>

export type ProviderTargetListProjection = Readonly<{
  state: 'available' | 'unavailable'
  reason?: string
  items: readonly Readonly<{ targetListId: string; name: string; itemCount: number | null }>[]
}>

export type DataTransferSettingsOverview = Readonly<{
  providers: readonly Readonly<{
    capability: ProviderCapability
    connections: readonly ProviderConnection[]
  }>[]
  collections: readonly TransferCollection[]
}>

export type SourceSnapshot = Readonly<{
  snapshotId: string
  snapshotRevision: string
  providerKey: TransferProviderKey
  source:
    | Readonly<{
      kind: 'verified-connection'
      connectionId: string
      importSourceId?: string
      accountAssurance?: 'verified'
    }>
    | Readonly<{
      kind: 'one-shot'
      importSourceId: string
      acquisitionMethod: 'shared-link' | 'remote-browser'
      authorizationBasis: 'link-possession' | 'interactive-provider-session'
      accountAssurance: 'unverified'
    }>
  capturedAt: string
  totalListCount?: number
  totalItemCount?: number
  hasUnloadedLists?: boolean
  lists: readonly Readonly<{
    sourceListId: string
    name: string
    itemCount: number
    unresolvedItemCount: number
  }>[]
}>

export type ImportMapping = Readonly<{
  sourceListId: string
  selected: boolean
  target:
    | Readonly<{ kind: 'new'; collectionId: string; name: string }>
    | Readonly<{ kind: 'existing'; collectionId: string; expectedCollectionRevision: string }>
}>

export type ImportPlanPreview = Readonly<{
  planId: string
  planRevision: string
  snapshotId: string
  snapshotRevision: string
  source: SourceSnapshot['source']
  mappings: readonly ImportMapping[]
  summary: Readonly<{
    add: number | null
    alreadyPresent: number | null
    reviewRequired: number | null
    unsupported: number | null
  }>
  providerDetails: Readonly<{
    pending: number
    available: number
    unavailable: number
  }>
  matches: readonly Readonly<{
    sourceListId: string
    sourceItemId: string
    sourceName: string
    sourceAddress: string | null
    sourceListName: string
    status: 'add' | 'already-present' | 'review-required' | 'unsupported' | 'skipped'
    providerDetailStatus: 'pending' | 'available' | 'unavailable' | null
    placeId?: string
    matchedPlaceName?: string
    reason?: string
  }>[]
  approvalEligible: boolean
  approvalReason?: string
}>

export type OutboundTransferPreview = Readonly<{
  transferId: string
  transferRevision: string
  state: 'ready-for-approval' | 'blocked'
  providerKey: TransferProviderKey
  collectionId: string
  targetList: Readonly<{ kind: 'new'; name: string } | { kind: 'existing'; targetListId: string; name: string }>
  summary: Readonly<{
    add: number | null
    alreadyPresent: number | null
    unresolved: number | null
    unsupported: number | null
  }>
  items: readonly Readonly<{
    placeId: string
    name: string
    status: 'add' | 'already-present' | 'unresolved' | 'unsupported'
    reason?: string
  }>[]
  blockedReason?: string
  approvalEligible: boolean
}>

export type TransferOperationReceipt = Readonly<{
  operationId: string
  state: 'applying' | 'completed' | 'approved' | 'action-required' | 'blocked'
}>

export type DataTransferSettingsGateway = Readonly<{
  overview(signal?: AbortSignal): Promise<DataTransferSettingsOverview>
  collection(collectionId: string, signal?: AbortSignal): Promise<TransferCollection>
  targetLists(connectionId: string, signal?: AbortSignal): Promise<ProviderTargetListProjection>
  connectionCommand(input: Readonly<{
    commandId: string
    kind: 'connect' | 'reconnect' | 'disconnect'
    providerKey: TransferProviderKey
    connectionId?: string
    expectedRevision?: string
  }>, signal?: AbortSignal): Promise<void>
  acquireSnapshot(input: Readonly<{
    commandId: string
    providerKey: TransferProviderKey
    connectionId: string
  }>, signal?: AbortSignal): Promise<SourceSnapshot>
  previewImport(input: Readonly<{
    commandId: string
    snapshotId: string
    expectedSnapshotRevision: string
    mappings: readonly ImportMapping[]
  }>, signal?: AbortSignal): Promise<ImportPlanPreview>
  importPlan(planId: string, signal?: AbortSignal): Promise<ImportPlanPreview>
  approveImport(input: Readonly<{
    commandId: string
    planId: string
    expectedPlanRevision: string
  }>, signal?: AbortSignal): Promise<TransferOperationReceipt>
  decideImportItem(input: Readonly<{
    commandId: string
    planId: string
    expectedPlanRevision: string
    sourceListId: string
    sourceItemId: string
    decision: Readonly<{ kind: 'link'; placeId: string }> | Readonly<{ kind: 'skip' }>
  }>, signal?: AbortSignal): Promise<ImportPlanPreview>
  previewExport(input: Readonly<{
    commandId: string
    providerKey: TransferProviderKey
    connectionId: string
    collectionId: string
    expectedCollectionRevision: string
    selection: Readonly<{ kind: 'all' }> | Readonly<{ kind: 'places'; placeIds: readonly string[] }>
    targetList: Readonly<{ kind: 'new'; name: string }> | Readonly<{ kind: 'existing'; targetListId: string; name: string }>
  }>, signal?: AbortSignal): Promise<OutboundTransferPreview>
  approveExport(input: Readonly<{
    commandId: string
    transferId: string
    expectedTransferRevision: string
  }>, signal?: AbortSignal): Promise<TransferOperationReceipt>
}>

export class DataTransferSettingsProblem extends Error {
  override readonly name = 'DataTransferSettingsProblem'

  constructor(readonly status: number, readonly code?: string) {
    super(`Data transfer settings request failed with ${status}`)
  }
}

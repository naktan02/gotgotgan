import type { ConnectorProviderKey } from '@place/contracts/connector'

export type SavedPlaceTargetCapabilityState =
  | 'available'
  | 'integration-gated'
  | 'unavailable'

export type SavedPlaceTargetCapability =
  | 'list-target-lists'
  | 'create-target-list'
  | 'resolve-places'
  | 'preflight-add'
  | 'add-places'
  | 'reconcile-add'

export type SavedPlaceTargetTransport =
  | 'official-api'
  | 'browser-session'
  | 'account-import'

export type SavedPlaceTargetCapabilities = Readonly<{
  providerKey: ConnectorProviderKey
  deliveryState: SavedPlaceTargetCapabilityState
  transport: SavedPlaceTargetTransport | null
  capabilities: Readonly<Record<SavedPlaceTargetCapability, SavedPlaceTargetCapabilityState>>
  maximumAddItems: number | null
  preservesOrder: 'supported' | 'unsupported' | 'unknown'
  acceptsPrivateNotes: 'supported' | 'unsupported' | 'unknown'
  evidence: Readonly<{
    kind: 'verified-adapter' | 'research-required' | 'public-api-unavailable'
    summary: string
  }>
}>

export type SavedPlaceTargetBoundary =
  | Readonly<{
      status: 'action-required'
      reason: 'reauth-required' | 'mfa-required' | 'captcha-required' | 'consent-required'
    }>
  | Readonly<{
      status: 'rate-limited'
      retryAfterMilliseconds?: number
    }>
  | Readonly<{
      status: 'unsupported'
      capability: SavedPlaceTargetCapability
    }>
  | Readonly<{
      status: 'provider-unavailable'
      retryable: boolean
    }>
  | Readonly<{ status: 'provider-drift' }>
  | Readonly<{ status: 'cancelled' }>

export type SavedPlaceTargetList = Readonly<{
  targetListId: string
  name: string
  itemCount?: number
  revision?: string
}>

export type SavedPlaceTargetListResult =
  | Readonly<{
      status: 'completed'
      lists: readonly SavedPlaceTargetList[]
      observedAt: string
    }>
  | SavedPlaceTargetBoundary

export type SavedPlaceTargetCreateResult =
  | Readonly<{
      status: 'created' | 'replayed'
      targetList: SavedPlaceTargetList
      receiptReference: string
    }>
  | Readonly<{
      status: 'outcome-unknown'
      reconciliationReference: string
    }>
  | SavedPlaceTargetBoundary

export type SavedPlacePreflightPlace = Readonly<{
  exportItemId: string
  providerPlaceId?: string
  name: string
  address?: string
  location?: Readonly<{ latitude: number; longitude: number }>
}>

export type SavedPlacePreflightItem =
  | Readonly<{
      exportItemId: string
      status: 'resolved'
      providerPlaceId: string
      resolution: 'existing-identity' | 'provider-match'
    }>
  | Readonly<{
      exportItemId: string
      status: 'ambiguous'
      candidates: readonly Readonly<{
        providerPlaceId: string
        name: string
        address?: string
      }>[]
    }>
  | Readonly<{ exportItemId: string; status: 'not-found' }>
  | Readonly<{ exportItemId: string; status: 'unsupported' }>

export type SavedPlaceTargetPreflightResult =
  | Readonly<{
      status: 'completed'
      preflightReference: string
      targetListRevision?: string
      observedAt: string
      items: readonly SavedPlacePreflightItem[]
    }>
  | SavedPlaceTargetBoundary

export type SavedPlaceTargetAddItem = Readonly<{
  exportItemId: string
  providerPlaceId: string
  position?: number
}>

/**
 * Opaque proof that the Backend consumed the one-time export token and accepted the exact approved
 * plan. This is not produced by local claim validation and is required before Provider mutation.
 */
export type SavedPlaceTargetAuthorizationReceipt = Readonly<{
  receiptReference: string
  operationId: string
  providerKey: ConnectorProviderKey
  planDigest: string
  expiresAt: string
}>

export type SavedPlaceTargetAddItemResult =
  | Readonly<{ exportItemId: string; status: 'applied' | 'already-present' }>
  | Readonly<{
      exportItemId: string
      status: 'failed'
      retryable: boolean
      code: string
    }>
  | Readonly<{
      exportItemId: string
      status: 'outcome-unknown'
      reconciliationReference: string
    }>

export type SavedPlaceTargetAddResult =
  | Readonly<{
      status: 'completed' | 'partial' | 'replayed'
      receiptReference: string
      items: readonly SavedPlaceTargetAddItemResult[]
    }>
  | Readonly<{
      status: 'outcome-unknown'
      reconciliationReference: string
    }>
  | SavedPlaceTargetBoundary

export type SavedPlaceTargetReconciliationResult =
  | Readonly<{
      status: 'reconciled'
      receiptReference: string
      items: readonly Readonly<{
        exportItemId: string
        status: 'present' | 'absent' | 'unknown'
      }>[]
    }>
  | Readonly<{
      status: 'outcome-unknown'
      reconciliationReference: string
    }>
  | SavedPlaceTargetBoundary

/**
 * Provider-neutral outbound boundary. Import remains on SavedPlaceSource; a Provider adapter must
 * prove and expose write support independently before implementing this port.
 */
export interface SavedPlaceTarget {
  readonly providerKey: ConnectorProviderKey
  readonly capabilities: SavedPlaceTargetCapabilities

  listTargetLists(input: Readonly<{
    signal: AbortSignal
  }>): Promise<SavedPlaceTargetListResult>

  createTargetList(input: Readonly<{
    commandId: string
    requestFingerprint: string
    authorization: SavedPlaceTargetAuthorizationReceipt
    name: string
    signal: AbortSignal
  }>): Promise<SavedPlaceTargetCreateResult>

  preflight(input: Readonly<{
    planDigest: string
    targetListId: string
    places: readonly SavedPlacePreflightPlace[]
    signal: AbortSignal
  }>): Promise<SavedPlaceTargetPreflightResult>

  add(input: Readonly<{
    operationId: string
    requestFingerprint: string
    planDigest: string
    authorization: SavedPlaceTargetAuthorizationReceipt
    preflightReference: string
    targetListId: string
    expectedTargetListRevision?: string
    items: readonly SavedPlaceTargetAddItem[]
    signal: AbortSignal
  }>): Promise<SavedPlaceTargetAddResult>

  reconcile(input: Readonly<{
    operationId: string
    requestFingerprint: string
    targetListId: string
    reconciliationReference: string
    items: readonly SavedPlaceTargetAddItem[]
    signal: AbortSignal
  }>): Promise<SavedPlaceTargetReconciliationResult>
}

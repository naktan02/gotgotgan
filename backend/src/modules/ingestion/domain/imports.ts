export const importBatchStates = [
  'queued',
  'running',
  'partial',
  'enriching',
  'needs-user-action',
  'needs-review',
  'completed',
  'failed',
  'cancelled',
] as const

export type ImportBatchState = (typeof importBatchStates)[number]

export type ImportProgress = Readonly<{
  discovered: number
  ready: number
  reviewRequired: number
  enriching: number
  applied: number
  skipped: number
  failed: number
}>

export type ImportFailureCode =
  | 'provider-auth-expired'
  | 'provider-mfa-required'
  | 'provider-captcha-required'
  | 'provider-consent-required'
  | 'provider-rate-limited'
  | 'provider-parser-drift'
  | 'provider-unavailable'
  | 'capture-invalid'
  | 'internal-failure'

export type PlaceImportBatch = Readonly<{
  batchId: string
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  state: ImportBatchState
  progress: ImportProgress
  failure?: Readonly<{ code: ImportFailureCode; retryable: boolean }>
  createdAt: string
  updatedAt: string
}>

export type ProviderConnectionProjection = Readonly<{
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  label: string
  status: 'ready' | 'action-required' | 'revoked'
  lastVerifiedAt: string | null
}>

export type PlaceImportItem = Readonly<{
  itemId: string
  batchId: string
  providerKey: 'naver' | 'kakao' | 'google'
  providerPlaceId?: string
  sourceListId: string
  sourceItemId: string
  listName: string
  name: string
  address: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  status: 'enriching' | 'ready' | 'needs-review' | 'applied' | 'skipped' | 'failed'
  reviewReasons: readonly string[]
  canonicalPlaceId?: string
  detailStatus: 'pending' | 'available' | 'unavailable'
}>

export class ProviderConnectionUnavailableError extends Error {
  override readonly name = 'ProviderConnectionUnavailableError'
}

export class ImportRequestConflictError extends Error {
  override readonly name = 'ImportRequestConflictError'
}

export class ImportReferenceUnavailableError extends Error {
  override readonly name = 'ImportReferenceUnavailableError'
}

export class ImportLeaseLostError extends Error {
  override readonly name = 'ImportLeaseLostError'
}

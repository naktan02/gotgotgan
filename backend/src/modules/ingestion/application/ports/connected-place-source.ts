import type { AcquisitionKind } from '../../domain/model.js'
import type { ImportFailureCode } from '../../domain/imports.js'

export type ProviderConnectionHandle = Readonly<{
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  secretReference?: string
  profileReference?: string
}>

export type ConnectedPlaceItem = Readonly<{
  sourceItemKey: string
  sourceListId: string
  sourceListPosition: number
  sourcePosition: number
  providerPlaceId?: string
  listName: string
  name: string
  address: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  reviewReasons: readonly string[]
}>

export type ConnectedPlacePageResult =
  | Readonly<{
      kind: 'page'
      capture: Readonly<{
        body: Uint8Array
        checksum: string
        contentType: 'application/json'
        acquisitionKind: AcquisitionKind
        parserVersion: string
        observedAt: string
      }>
      items: readonly ConnectedPlaceItem[]
      nextCursor: string | null
    }>
  | Readonly<{
      kind: 'needs-user-action'
      code: Extract<
        ImportFailureCode,
        | 'provider-auth-expired'
        | 'provider-mfa-required'
        | 'provider-captcha-required'
        | 'provider-consent-required'
        | 'provider-parser-drift'
      >
    }>
  | Readonly<{
      kind: 'failure'
      code: Extract<
        ImportFailureCode,
        'provider-rate-limited' | 'provider-unavailable' | 'capture-invalid'
      >
      retryable: boolean
    }>

export interface ConnectedPlaceSource {
  readonly providerKey: 'naver' | 'kakao' | 'google'
  readPage(input: Readonly<{
    connection: ProviderConnectionHandle
    cursor: string | null
    limit: number
    signal: AbortSignal
  }>): Promise<ConnectedPlacePageResult>
}

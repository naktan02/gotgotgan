import type { AcquisitionKind } from '../../domain/model.js'
import type { ImportFailureCode } from '../../domain/imports.js'

export type EnrichedPlaceDetail = Readonly<{
  name: string
  address: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  reviewReasons: readonly string[]
}>

export type PlaceEnrichmentResult =
  | Readonly<{
      kind: 'detail'
      evidence: Readonly<{
        checksum: string
        parserVersion: string
        acquisitionKind: AcquisitionKind
        observedAt: string
      }>
      place: EnrichedPlaceDetail
    }>
  | Readonly<{
      kind: 'failure'
      code: Extract<
        ImportFailureCode,
        'provider-rate-limited' | 'provider-unavailable' | 'provider-parser-drift' | 'capture-invalid'
      >
      retryable: boolean
    }>

export interface PlaceEnrichmentSource {
  readonly providerKey: 'naver' | 'kakao' | 'google'
  readDetail(input: Readonly<{
    providerPlaceId: string
    signal: AbortSignal
  }>): Promise<PlaceEnrichmentResult>
}

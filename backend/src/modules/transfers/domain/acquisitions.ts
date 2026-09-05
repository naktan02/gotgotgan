import type {
  ImportAcquisitionCommandResultV1,
  ImportAcquisitionCommandV1,
  ImportAcquisitionV1,
  StartImportAcquisitionV1,
} from '@place/contracts/transfers'

export type SharedLinkInspectionItem = Readonly<{
  sourceItemId: string
  providerPlaceId: string | null
  observedName: string
  observedAddress: string | null
  observedCategory: string | null
  observedLocation: Readonly<{ latitude: number; longitude: number }> | null
  sourcePosition: number
}>

export type SharedLinkInspectionResult =
  | Readonly<{
      entryId: string
      position: number
      status: 'succeeded'
      inputUrlDigest: string
      shareId: string
      list: Readonly<{
        sourceListId: string
        observedName: string
        sourcePosition: number
        items: readonly SharedLinkInspectionItem[]
      }>
    }>
  | Readonly<{
      entryId: string
      position: number
      status: 'duplicate'
      inputUrlDigest: string
      duplicateOfEntryId: string
    }>
  | Readonly<{
      entryId: string
      position: number
      status: 'failed'
      inputUrlDigest: string
      code:
        | 'invalid-url'
        | 'unsupported-host'
        | 'redirect-policy-denied'
        | 'share-not-found'
        | 'share-not-readable'
        | 'provider-rate-limited'
        | 'provider-unavailable'
        | 'request-timeout'
        | 'response-too-large'
        | 'source-limit-exceeded'
        | 'provider-parser-drift'
      retryable: boolean
    }>

/** One-shot web source. Link access is not evidence that the provider account belongs to the member. */
export interface SharedLinkImportSource {
  readonly providerKey: 'naver'
  inspect(input: Readonly<{
    entries: readonly Readonly<{ entryId: string; position: number; url: string }>[]
    signal: AbortSignal
  }>): Promise<readonly SharedLinkInspectionResult[]>
}

export interface ImportAcquisitions {
  start(memberId: string, command: StartImportAcquisitionV1):
    Promise<ImportAcquisitionCommandResultV1>
  get(memberId: string, acquisitionId: string): Promise<ImportAcquisitionV1 | undefined>
  applyCommand(memberId: string, command: ImportAcquisitionCommandV1):
    Promise<ImportAcquisitionCommandResultV1>
}

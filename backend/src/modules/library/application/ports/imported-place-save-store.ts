export type ImportedPlaceSaveAttempt = Readonly<{
  commandId: string
  memberId: string
  canonicalPlaceId: string
  occurredAt: string
  fingerprint: string
  source: Readonly<{
    providerKey: 'naver' | 'kakao' | 'google'
    connectionId: string
    listId: string
    listName: string
    collectionName: string
    listPosition: number
    position: number
  }>
}>

export interface ImportedPlaceSaveStore {
  saveImportedPlace(attempt: ImportedPlaceSaveAttempt): Promise<Readonly<{
    status: 'applied' | 'replayed' | 'conflict' | 'not-found' | 'forbidden'
  }>>
}

export interface ImportedPlaceLibraryPort {
  saveImportedPlace(input: Readonly<{
    commandId: string
    memberId: string
    canonicalPlaceId: string
    occurredAt: string
    source: Readonly<{
      providerKey: 'naver' | 'kakao' | 'google'
      connectionId: string
      listId: string
      listName: string
      listPosition: number
      position: number
    }>
  }>): Promise<Readonly<{
    status: 'applied' | 'replayed' | 'conflict' | 'not-found' | 'forbidden'
  }>>
}

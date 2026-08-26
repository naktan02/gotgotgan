export interface ImportedPlaceLibraryPort {
  saveImportedPlace(input: Readonly<{
    commandId: string
    memberId: string
    canonicalPlaceId: string
    occurredAt: string
  }>): Promise<Readonly<{
    status: 'applied' | 'replayed' | 'conflict' | 'not-found' | 'forbidden'
  }>>
}

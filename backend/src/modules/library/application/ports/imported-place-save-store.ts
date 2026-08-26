export type ImportedPlaceSaveAttempt = Readonly<{
  commandId: string
  memberId: string
  canonicalPlaceId: string
  occurredAt: string
  fingerprint: string
}>

export interface ImportedPlaceSaveStore {
  saveImportedPlace(attempt: ImportedPlaceSaveAttempt): Promise<Readonly<{
    status: 'applied' | 'replayed' | 'conflict' | 'not-found' | 'forbidden'
  }>>
}

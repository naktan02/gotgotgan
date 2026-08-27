export type VisitHistoryPage = Readonly<{
  schemaVersion: 'visit-history.v1'
  placeId: string
  items: readonly Readonly<{
    visitId: string
    visitedAt: string
    recordedAt: string
  }>[]
  nextCursor?: string
}>

export class InvalidVisitCursorError extends Error {
  override readonly name = 'InvalidVisitCursorError'
}

export class InvalidVisitQueryError extends Error {
  override readonly name = 'InvalidVisitQueryError'
}

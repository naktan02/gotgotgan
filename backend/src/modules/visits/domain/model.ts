export type VisitRecord = Readonly<{
  id: string
  memberId: string
  placeId: string
  visitedAt: string
  recordedAt: string
  evidence?: Readonly<Record<string, unknown>>
  fingerprint: string
}>

export type VisitSummary =
  | Readonly<{ visited: false; count: 0 }>
  | Readonly<{
      visited: true
      count: number
      firstVisitedAt: string
      lastVisitedAt: string
    }>

export class InvalidVisitError extends Error {
  override readonly name = 'InvalidVisitError'
}

export class VisitIdConflictError extends Error {
  override readonly name = 'VisitIdConflictError'
}

export function assertVisitTime(visitedAt: string, recordedAt: string): void {
  const visited = Date.parse(visitedAt)
  const recorded = Date.parse(recordedAt)
  if (Number.isNaN(visited) || Number.isNaN(recorded) || visited > recorded) {
    throw new InvalidVisitError('visit timestamps are invalid')
  }
}

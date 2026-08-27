import type { VisitHistoryPage } from '../domain/queries.js'

export interface VisitQueries {
  listPlaceVisits(input: Readonly<{
    memberId: string
    placeId: string
    cursor?: string
    limit: number
  }>): Promise<VisitHistoryPage>
}

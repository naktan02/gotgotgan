import type { VisitRecord, VisitSummary } from '../../domain/model.js'

export interface VisitStore {
  append(record: VisitRecord): Promise<'recorded' | 'conflict'>
  summarize(memberId: string, placeId: string): Promise<VisitSummary>
}

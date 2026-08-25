import { describe, expect, it } from 'vitest'

import {
  recordVisit,
  VisitIdConflictError,
  type VisitRecord,
  type VisitStore,
} from '../index.js'

class MemoryVisitStore implements VisitStore {
  readonly visits = new Map<string, VisitRecord>()

  async append(record: VisitRecord) {
    const prior = this.visits.get(record.id)
    if (prior !== undefined) return prior.fingerprint === record.fingerprint ? 'recorded' as const : 'conflict' as const
    this.visits.set(record.id, record)
    return 'recorded' as const
  }

  async summarize(memberId: string, placeId: string) {
    const timestamps = [...this.visits.values()]
      .filter((visit) => visit.memberId === memberId && visit.placeId === placeId)
      .map((visit) => visit.visitedAt)
      .sort()
    return timestamps.length === 0
      ? { visited: false as const, count: 0 as const }
      : { visited: true as const, count: timestamps.length, firstVisitedAt: timestamps[0]!, lastVisitedAt: timestamps.at(-1)! }
  }

  async list(memberId: string, placeId: string) {
    return [...this.visits.values()].filter((visit) => visit.memberId === memberId && visit.placeId === placeId)
  }
}

describe('repeatable visits', () => {
  it('records repeated visits and derives visited state, count, first, and last', async () => {
    const store = new MemoryVisitStore()
    const base = {
      memberId: '01992d01-0000-7000-8000-000000000001',
      placeId: '01992d01-0000-7000-8000-000000000002',
      recordedAt: '2026-08-26T10:00:00.000Z',
      store,
    }
    await recordVisit({ ...base, id: '01992d01-0000-7000-8000-000000000003', visitedAt: '2026-07-01T12:00:00.000Z' })
    await recordVisit({ ...base, id: '01992d01-0000-7000-8000-000000000004', visitedAt: '2026-08-01T12:00:00.000Z' })

    await expect(store.summarize(base.memberId, base.placeId)).resolves.toEqual({
      visited: true,
      count: 2,
      firstVisitedAt: '2026-07-01T12:00:00.000Z',
      lastVisitedAt: '2026-08-01T12:00:00.000Z',
    })
  })

  it('accepts an identical retry and rejects reuse for a different visit', async () => {
    const store = new MemoryVisitStore()
    const input = {
      id: '01992d01-0000-7000-8000-000000000010',
      memberId: '01992d01-0000-7000-8000-000000000011',
      placeId: '01992d01-0000-7000-8000-000000000012',
      visitedAt: '2026-08-01T12:00:00.000Z',
      recordedAt: '2026-08-26T10:00:00.000Z',
      store,
    }
    await expect(recordVisit(input)).resolves.toEqual({ status: 'recorded' })
    await expect(recordVisit(input)).resolves.toEqual({ status: 'recorded' })
    await expect(recordVisit({ ...input, visitedAt: '2026-08-02T12:00:00.000Z' }))
      .rejects.toBeInstanceOf(VisitIdConflictError)
  })
})

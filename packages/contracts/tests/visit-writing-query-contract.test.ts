import { describe, expect, it } from 'vitest'

import {
  visitHistoryQuerySchema,
  visitHistoryResponseSchema,
} from '../src/visits/index.js'
import {
  writingDetailResponseSchema,
  writingListQuerySchema,
  writingListResponseSchema,
} from '../src/writing/index.js'

const placeId = '01992d21-0000-7000-8000-000000000001'
const visitId = '01992d21-0000-7000-8000-000000000002'
const documentId = '01992d21-0000-7000-8000-000000000003'
const at = '2026-08-28T00:00:00.000Z'

describe('bounded Visit and Writing query contracts', () => {
  it('defaults list queries to bounded pages', () => {
    expect(visitHistoryQuerySchema.parse({})).toEqual({ limit: 20 })
    expect(writingListQuerySchema.parse({})).toEqual({ kind: 'all', limit: 20 })
    expect(visitHistoryQuerySchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(writingListQuerySchema.safeParse({ limit: 0 }).success).toBe(false)
  })

  it('keeps Visit history free of persistence and member fields', () => {
    const response = visitHistoryResponseSchema.parse({
      schemaVersion: 'visit-history.v1',
      placeId,
      items: [{ visitId, visitedAt: at, recordedAt: at }],
    })
    expect(response.items[0]).toEqual({ visitId, visitedAt: at, recordedAt: at })
    expect(visitHistoryResponseSchema.safeParse({
      ...response,
      items: [{ ...response.items[0], memberId: placeId, fingerprint: 'secret' }],
    }).success).toBe(false)
  })

  it('bounds Writing list bodies and reserves full content for detail', () => {
    const list = writingListResponseSchema.parse({
      schemaVersion: 'writing-list.v1',
      filter: { kind: 'all' },
      items: [{
        documentId,
        kind: 'note',
        title: null,
        bodyPreview: '짧은 메모',
        bodyTruncated: false,
        visibility: 'private',
        publicationId: null,
        version: 1,
        placeIds: [placeId],
        updatedAt: at,
      }],
    })
    expect(list.items[0]).not.toHaveProperty('body')
    expect(writingListResponseSchema.safeParse({
      ...list,
      items: [{ ...list.items[0], bodyPreview: 'x'.repeat(281) }],
    }).success).toBe(false)

    expect(writingDetailResponseSchema.parse({
      schemaVersion: 'writing-detail.v1',
      document: {
        documentId,
        kind: 'note',
        title: null,
        body: '전체 메모',
        visibility: 'private',
        publicationId: null,
        version: 1,
        placeIds: [placeId],
        createdAt: at,
        updatedAt: at,
      },
    }).document.body).toBe('전체 메모')
  })
})

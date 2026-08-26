import { describe, expect, it } from 'vitest'

import {
  placeImportBatchSchema,
  placeImportRequestSchema,
  placeImportReviewRequestSchema,
  providerConnectionProjectionSchema,
} from '../src/imports/index.js'

const connectionId = '01992d20-7000-7000-8000-000000000001'
const batchId = '01992d20-7000-7000-8000-000000000002'
const commandId = '01992d20-7000-7000-8000-000000000003'
const itemId = '01992d20-7000-7000-8000-000000000004'

describe('connected-place import contracts', () => {
  it('accepts only an opaque connection and idempotency identity from the browser', () => {
    expect(placeImportRequestSchema.parse({
      schemaVersion: 'place-import-request.v1',
      connectionId,
      idempotencyKey: commandId,
    })).toEqual({
      schemaVersion: 'place-import-request.v1',
      connectionId,
      idempotencyKey: commandId,
    })

    expect(placeImportRequestSchema.safeParse({
      schemaVersion: 'place-import-request.v1',
      connectionId,
      idempotencyKey: commandId,
      membershipId: commandId,
      secretReference: 'secret/path',
      profilePath: 'C:/personal-profile',
      cookie: 'credential',
    }).success).toBe(false)
  })

  it('publishes safe connection and durable batch projections', () => {
    expect(providerConnectionProjectionSchema.parse({
      schemaVersion: 'place-provider-connection.v1',
      connectionId,
      providerKey: 'naver',
      label: '내 NAVER 지도',
      status: 'ready',
      lastVerifiedAt: '2026-08-26T10:00:00.000Z',
    })).not.toHaveProperty('secretReference')

    const batch = placeImportBatchSchema.parse({
      schemaVersion: 'place-import-batch.v1',
      batchId,
      connectionId,
      providerKey: 'naver',
      state: 'needs-review',
      progress: {
        discovered: 3,
        ready: 2,
        reviewRequired: 1,
        applied: 0,
        skipped: 0,
        failed: 0,
      },
      createdAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:01:00.000Z',
    })
    expect(batch.state).toBe('needs-review')
    expect(batch).not.toHaveProperty('leaseOwner')
    expect(batch).not.toHaveProperty('captureReference')
  })

  it('requires an explicit, bounded review action', () => {
    expect(placeImportReviewRequestSchema.parse({
      schemaVersion: 'place-import-review.v1',
      commandId,
      itemId,
      action: { kind: 'link-place', canonicalPlaceId: batchId },
    }).action).toEqual({ kind: 'link-place', canonicalPlaceId: batchId })

    expect(placeImportReviewRequestSchema.safeParse({
      schemaVersion: 'place-import-review.v1',
      commandId,
      itemId,
      action: { kind: 'link-place' },
    }).success).toBe(false)
  })
})

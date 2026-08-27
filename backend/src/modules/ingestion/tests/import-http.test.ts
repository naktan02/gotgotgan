import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

import {
  registerImportHttpRoutes,
  type ImportManagementStore,
  type ImportQueries,
  type ImportRequestStore,
  type ProviderConnectionStore,
} from '../index.js'

const memberId = '01992d20-9000-7000-8000-000000000001'
const connectionId = '01992d20-9000-7000-8000-000000000002'
const batchId = '01992d20-9000-7000-8000-000000000003'
const idempotencyKey = '01992d20-9000-7000-8000-000000000004'
const at = '2026-08-26T11:00:00.000Z'
const batch = {
  batchId,
  connectionId,
  providerKey: 'naver' as const,
  state: 'queued' as const,
  progress: { discovered: 0, ready: 0, reviewRequired: 0, enriching: 0, applied: 0, skipped: 0, failed: 0 },
  createdAt: at,
  updatedAt: at,
}

function fixture() {
  const requestStore: ImportRequestStore = {
    requestImport: vi.fn(async () => ({ status: 'created' as const, batch })),
  }
  const managementStore: ImportManagementStore = {
    cancelImport: vi.fn(async () => ({ ...batch, state: 'cancelled' as const })),
    resumeImport: vi.fn(async () => batch),
  }
  const queries: ImportQueries = {
    listBatches: vi.fn<ImportQueries['listBatches']>(async (input) => ({
      schemaVersion: 'place-import-batch-list.v1',
      filter: { state: input.state },
      items: [batch],
    })),
    getBatch: vi.fn<ImportQueries['getBatch']>(async () => ({
      schemaVersion: 'place-import-batch-detail.v1', batch, items: [],
    })),
  }
  const connectionStore: ProviderConnectionStore = {
    registerConnection: vi.fn(async () => 'registered' as const),
    listConnections: vi.fn(async () => [{
      connectionId, providerKey: 'naver' as const, label: '내 NAVER 지도', status: 'ready' as const, lastVerifiedAt: at,
    }]),
  }
  const app = Fastify({ logger: false })
  registerImportHttpRoutes(app, {
    authorizer: async (authorization) => authorization === 'Bearer good'
      ? { status: 'authorized', memberId }
      : { status: 'authentication-required' },
    requestStore,
    managementStore,
    queries,
    connectionStore,
    nextBatchId: () => batchId,
    nextJobId: () => '01992d20-9000-7000-8000-000000000005',
    now: () => new Date(at),
    review: {
      store: {
        beginReview: async (input) => ({
          status: 'replayed' as const,
          result: {
            status: 'replayed' as const,
            commandId: input.commandId,
            itemId: input.itemId,
          },
        }),
        completeReview: async (input) => ({
          status: input.status,
          commandId: input.commandId,
          itemId: input.itemId,
        }),
      },
      ingestionStore: { append: async () => 'recorded' as const },
      canonical: {
        resolveProviderIdentity: async () => ({ status: 'not-found' as const }),
        apply: async () => ({ status: 'applied' as const }),
      },
      library: { saveImportedPlace: async () => ({ status: 'applied' as const }) },
    },
  })
  return { app, requestStore, managementStore, queries, connectionStore }
}

describe('connected import HTTP boundary', () => {
  it('takes membership only from authorization and returns sanitized connections', async () => {
    const { app } = fixture()
    expect((await app.inject({ method: 'GET', url: '/v1/provider-connections' })).statusCode).toBe(401)
    const response = await app.inject({
      method: 'GET', url: '/v1/provider-connections', headers: { authorization: 'Bearer good' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      schemaVersion: 'place-provider-connections.v1',
      items: [{ connectionId, providerKey: 'naver', status: 'ready' }],
    })
    expect(response.body).not.toMatch(/profile|secret|cookie|password/i)
    await app.close()
  })

  it('starts, reads, cancels, and resumes an import through stable contracts', async () => {
    const { app, requestStore, managementStore } = fixture()
    const headers = { authorization: 'Bearer good' }
    const started = await app.inject({
      method: 'POST', url: '/v1/imports', headers,
      payload: { schemaVersion: 'place-import-request.v1', connectionId, idempotencyKey },
    })
    expect(started.statusCode).toBe(202)
    expect(started.json()).toMatchObject({ schemaVersion: 'place-import-batch.v1', batchId })
    expect(requestStore.requestImport).toHaveBeenCalledWith(expect.objectContaining({ memberId, connectionId }))

    const detail = await app.inject({ method: 'GET', url: `/v1/imports/${batchId}`, headers })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toEqual({
      schemaVersion: 'place-import-batch-detail.v1',
      batch: { schemaVersion: 'place-import-batch.v1', ...batch },
      items: [],
    })
    expect((await app.inject({
      method: 'POST', url: `/v1/imports/${batchId}/cancel`, headers,
      payload: { schemaVersion: 'place-import-cancel.v1' },
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'POST', url: `/v1/imports/${batchId}/resume`, headers,
      payload: { schemaVersion: 'place-import-resume.v1' },
    })).statusCode).toBe(200)
    expect(managementStore.cancelImport).toHaveBeenCalledWith(memberId, batchId, at)
    expect(managementStore.resumeImport).toHaveBeenCalledWith(memberId, batchId, at)
    await app.close()
  })

  it('rejects actor injection and malformed identifiers', async () => {
    const { app, requestStore } = fixture()
    const response = await app.inject({
      method: 'POST', url: '/v1/imports', headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'place-import-request.v1', connectionId, idempotencyKey,
        memberId: '01992d20-9000-7000-8000-000000000099',
      },
    })
    expect(response.statusCode).toBe(400)
    expect(requestStore.requestImport).not.toHaveBeenCalled()
    await app.close()
  })

  it('accepts only an explicit review action and returns a replay-safe receipt', async () => {
    const { app } = fixture()
    const commandId = '01992d20-9000-7000-8000-000000000010'
    const itemId = '01992d20-9000-7000-8000-000000000011'
    const response = await app.inject({
      method: 'POST', url: '/v1/import-reviews',
      headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'place-import-review.v1', commandId, itemId,
        action: { kind: 'skip', reason: 'not needed' },
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      schemaVersion: 'place-import-review-result.v1',
      status: 'replayed', commandId, itemId,
    })
    await app.close()
  })
})

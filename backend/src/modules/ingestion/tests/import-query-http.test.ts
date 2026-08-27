import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  InvalidImportCursorError,
  registerImportHttpRoutes,
  type ImportManagementStore,
  type ImportQueries,
  type ImportRequestStore,
  type ProviderConnectionStore,
} from '../index.js'

const memberId = '01992d22-0000-7000-8000-000000000001'
const connectionId = '01992d22-0000-7000-8000-000000000002'
const batchId = '01992d22-0000-7000-8000-000000000003'
const at = '2026-08-28T08:00:00.000Z'
const batch = {
  batchId,
  connectionId,
  providerKey: 'naver' as const,
  state: 'completed' as const,
  progress: {
    discovered: 1, ready: 0, reviewRequired: 0, enriching: 0,
    applied: 1, skipped: 0, failed: 0,
  },
  createdAt: at,
  updatedAt: at,
}

const requestStore: ImportRequestStore = {
  requestImport: async () => ({ status: 'created', batch }),
}
const managementStore: ImportManagementStore = {
  cancelImport: async () => batch,
  resumeImport: async () => batch,
}
const connectionStore: ProviderConnectionStore = {
  registerConnection: async () => 'registered',
  listConnections: async () => [],
}

function fixture(overrides: Partial<ImportQueries> = {}) {
  const queries: ImportQueries = {
    listBatches: async (input) => ({
      schemaVersion: 'place-import-batch-list.v1',
      filter: { state: input.state },
      items: [batch],
    }),
    getBatch: async () => ({
      schemaVersion: 'place-import-batch-detail.v1',
      batch,
      items: [],
    }),
    ...overrides,
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
    nextJobId: () => '01992d22-0000-7000-8000-000000000004',
    now: () => new Date(at),
  })
  return app
}

describe('bounded Import HTTP queries', () => {
  it('requires a member and applies all/20 history defaults', async () => {
    const listBatches = vi.fn<ImportQueries['listBatches']>(async (input) => ({
      schemaVersion: 'place-import-batch-list.v1',
      filter: { state: input.state },
      items: [],
    }))
    const app = fixture({ listBatches })

    expect((await app.inject({ method: 'GET', url: '/v1/imports' })).statusCode).toBe(401)
    const response = await app.inject({
      method: 'GET', url: '/v1/imports', headers: { authorization: 'Bearer good' },
    })
    expect(response.statusCode).toBe(200)
    expect(listBatches).toHaveBeenCalledWith({ memberId, state: 'all', limit: 20 })
    await app.close()
  })

  it('publishes state-filtered history and keeps detail at the compatible 200 default', async () => {
    const getBatch = vi.fn<ImportQueries['getBatch']>(async () => ({
      schemaVersion: 'place-import-batch-detail.v1', batch, items: [],
    }))
    const app = fixture({ getBatch })
    const headers = { authorization: 'Bearer good' }

    const history = await app.inject({
      method: 'GET', url: '/v1/imports?state=completed&limit=10', headers,
    })
    expect(history.json()).toMatchObject({
      schemaVersion: 'place-import-batch-list.v1',
      filter: { state: 'completed' },
      items: [{ schemaVersion: 'place-import-batch.v1', batchId }],
    })
    const detail = await app.inject({
      method: 'GET', url: `/v1/imports/${batchId}`, headers,
    })
    expect(detail.statusCode).toBe(200)
    expect(getBatch).toHaveBeenCalledWith({ memberId, batchId, limit: 200 })
    await app.close()
  })

  it('rejects invalid limits and cursor failures and hides absent owner batches', async () => {
    const app = fixture({
      listBatches: async () => { throw new InvalidImportCursorError() },
      getBatch: async () => undefined,
    })
    const headers = { authorization: 'Bearer good' }
    expect((await app.inject({
      method: 'GET', url: '/v1/imports?limit=51', headers,
    })).statusCode).toBe(400)
    const cursor = await app.inject({
      method: 'GET', url: '/v1/imports?cursor=opaque', headers,
    })
    expect(cursor.statusCode).toBe(400)
    expect(cursor.json()).toMatchObject({ code: 'PLACE_IMPORT_CURSOR_INVALID' })
    expect((await app.inject({
      method: 'GET', url: `/v1/imports/${batchId}`, headers,
    })).statusCode).toBe(404)
    await app.close()
  })
})

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  InvalidWritingCursorError,
  registerWritingHttpRoutes,
  type WritingQueries,
  type WritingStore,
} from '../index.js'

const memberId = '01992d21-0000-7000-8000-000000000101'
const placeId = '01992d21-0000-7000-8000-000000000201'
const documentId = '01992d21-0000-7000-8000-000000000301'
const at = '2026-08-28T00:00:00.000Z'

const store: WritingStore = {
  apply: async () => ({ status: 'applied', documentId, version: 1 }),
  getPublished: async () => undefined,
}

function fixture(overrides: Partial<WritingQueries> = {}) {
  const queries: WritingQueries = {
    list: async (input) => ({
      schemaVersion: 'writing-list.v2',
      filter: { kind: input.kind },
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
        createdAt: at,
        updatedAt: at,
      }],
    }),
    get: async () => ({
      schemaVersion: 'writing-detail.v1',
      document: {
        documentId,
        kind: 'note',
        title: null,
        body: '짧은 메모',
        visibility: 'private',
        publicationId: null,
        version: 1,
        placeIds: [placeId],
        createdAt: at,
        updatedAt: at,
      },
    }),
    ...overrides,
  }
  const app = Fastify({ logger: false })
  registerWritingHttpRoutes(app, {
    authorizer: async (authorization) => authorization === 'Bearer good'
      ? { status: 'authorized', memberId }
      : { status: 'authentication-required' },
    store,
    queries,
    now: () => new Date(at),
  })
  return app
}

describe('bounded Writing HTTP queries', () => {
  it('requires a member and applies all/20 defaults', async () => {
    const list = vi.fn<WritingQueries['list']>(async (input) => ({
      schemaVersion: 'writing-list.v2', filter: { kind: input.kind }, items: [],
    }))
    const app = fixture({ list })

    expect((await app.inject({ method: 'GET', url: '/v1/writing' })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET', url: '/v1/writing', headers: { authorization: 'Bearer good' },
    })).statusCode).toBe(200)
    expect(list).toHaveBeenCalledWith({ memberId, kind: 'all', limit: 20 })
    await app.close()
  })

  it('passes one canonical Place filter to the Writing query Interface', async () => {
    const list = vi.fn<WritingQueries['list']>(async (input) => ({
      schemaVersion: 'writing-list.v2',
      filter: { kind: input.kind, placeId: input.placeId! },
      items: [],
    }))
    const app = fixture({ list })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/writing?kind=note&placeId=${placeId}&limit=10`,
      headers: { authorization: 'Bearer good' },
    })

    expect(response.statusCode).toBe(200)
    expect(list).toHaveBeenCalledWith({ memberId, kind: 'note', placeId, limit: 10 })
    expect(response.json().filter).toEqual({ kind: 'note', placeId })
    await app.close()
  })

  it('returns bounded summaries and owner detail separately', async () => {
    const app = fixture()
    const headers = { authorization: 'Bearer good' }
    const list = await app.inject({ method: 'GET', url: '/v1/writing?kind=note', headers })
    expect(list.json()).toMatchObject({
      schemaVersion: 'writing-list.v2',
      filter: { kind: 'note' },
      items: [{ documentId, bodyPreview: '짧은 메모' }],
    })
    expect(list.json().items[0]).not.toHaveProperty('body')

    const detail = await app.inject({
      method: 'GET', url: `/v1/writing/${documentId}`, headers,
    })
    expect(detail.json()).toHaveProperty('document.body', '짧은 메모')
    await app.close()
  })

  it('hides absent owner documents and rejects invalid cursors', async () => {
    const app = fixture({
      list: async () => { throw new InvalidWritingCursorError() },
      get: async () => undefined,
    })
    const headers = { authorization: 'Bearer good' }
    expect((await app.inject({
      method: 'GET', url: '/v1/writing?limit=51', headers,
    })).statusCode).toBe(400)
    const cursor = await app.inject({
      method: 'GET', url: '/v1/writing?cursor=opaque', headers,
    })
    expect(cursor.statusCode).toBe(400)
    expect(cursor.json()).toMatchObject({ code: 'PLACE_WRITING_CURSOR_INVALID' })
    expect((await app.inject({
      method: 'GET', url: `/v1/writing/${documentId}`, headers,
    })).statusCode).toBe(404)
    await app.close()
  })
})

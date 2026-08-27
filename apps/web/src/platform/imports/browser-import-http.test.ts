import { describe, expect, it, vi } from 'vitest'

import { createBrowserImportHttp } from './browser-import-http'

const batchId = '01992d20-0000-7000-8000-000000000001'
const connectionId = '01992d20-0000-7000-8000-000000000002'
const itemId = '01992d20-0000-7000-8000-000000000003'
const commandId = '01992d20-0000-7000-8000-000000000004'

function sessionRuntime() {
  return {
    bff: {
      resolveSession: async () => ({
        id: 'session-id',
        tokens: { accessToken: 'server-access-token', expiresAt: '2026-08-27T00:00:00.000Z' },
        expiresAt: '2026-08-27T00:00:00.000Z',
      }),
    },
  }
}

describe('browser import HTTP', () => {
  it('fails closed when its runtime is inactive', async () => {
    const http = createBrowserImportHttp({
      resolveAuthRuntime: () => undefined,
      resolveImportBackend: () => undefined,
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.connections(new Request('https://place.example/api/imports/connections'))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'PLACE_IMPORT_WEB_UNAVAILABLE', correlationRef: 'correlation-ref',
    })
  })

  it('requires a server-side session before calling the import backend', async () => {
    let called = false
    const http = createBrowserImportHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      resolveImportBackend: () => ({
        ready: async () => new Response(),
        connections: async () => { called = true; return new Response() },
        start: async () => new Response(), detail: async () => new Response(),
        cancel: async () => new Response(), resume: async () => new Response(), review: async () => new Response(),
      }),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.connections(new Request('https://place.example/api/imports/connections'))

    expect(response.status).toBe(401)
    expect(called).toBe(false)
  })

  it('returns only the contract projection and never returns access or profile material', async () => {
    const observedTokens: string[] = []
    const http = createBrowserImportHttp({
      resolveAuthRuntime: sessionRuntime,
      resolveImportBackend: () => ({
        ready: async () => new Response(),
        connections: async (token) => {
          observedTokens.push(token)
          return Response.json({
            schemaVersion: 'place-provider-connections.v1',
            items: [{
              schemaVersion: 'place-provider-connection.v1', connectionId,
              providerKey: 'naver', label: '내 NAVER 저장목록', status: 'ready',
              lastVerifiedAt: null, profileReference: 'profile:must-not-cross',
            }],
            secret: 'must-not-cross',
          })
        },
        start: async () => new Response(), detail: async () => new Response(),
        cancel: async () => new Response(), resume: async () => new Response(), review: async () => new Response(),
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.connections(new Request('https://place.example/api/imports/connections'))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(observedTokens).toEqual(['server-access-token'])
    expect(JSON.parse(body)).toEqual({
      schemaVersion: 'place-provider-connections.v1',
      items: [{
        schemaVersion: 'place-provider-connection.v1', connectionId,
        providerKey: 'naver', label: '내 NAVER 저장목록', status: 'ready', lastVerifiedAt: null,
      }],
    })
    expect(body).not.toMatch(/token|profile|secret|cookie/i)
  })

  it('validates start input before forwarding and preserves idempotency', async () => {
    const forwarded: unknown[] = []
    const http = createBrowserImportHttp({
      resolveAuthRuntime: sessionRuntime,
      resolveImportBackend: () => ({
        ready: async () => new Response(), connections: async () => new Response(),
        start: async (_token, body) => {
          forwarded.push(body)
          return Response.json({
            schemaVersion: 'place-import-batch.v1', batchId, connectionId, providerKey: 'naver',
            state: 'queued', progress: { discovered: 0, ready: 0, reviewRequired: 0, enriching: 0, applied: 0, skipped: 0, failed: 0 },
            createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
          }, { status: 202 })
        },
        detail: async () => new Response(), cancel: async () => new Response(),
        resume: async () => new Response(), review: async () => new Response(),
      }),
      createCorrelationRef: () => 'correlation-ref',
    })
    const invalid = await http.start(new Request('https://place.example/api/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    const requestBody = {
      schemaVersion: 'place-import-request.v1', connectionId,
      idempotencyKey: '01992d20-0000-7000-8000-000000000099',
    }
    const valid = await http.start(new Request('https://place.example/api/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
    }))

    expect(invalid.status).toBe(400)
    expect(valid.status).toBe(202)
    expect(forwarded).toEqual([requestBody])
  })

  it('rejects an invalid batch reference before resolving a session or backend', async () => {
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const resolveImportBackend = vi.fn()
    const http = createBrowserImportHttp({
      resolveAuthRuntime,
      resolveImportBackend,
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.detail(
      new Request('https://place.example/api/imports/not-a-uuid'),
      'not-a-uuid',
    )

    expect(response.status).toBe(400)
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
    expect(resolveImportBackend).not.toHaveBeenCalled()
  })

  it('rejects unbounded or unknown detail query fields before resolving a session', async () => {
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const resolveImportBackend = vi.fn()
    const http = createBrowserImportHttp({
      resolveAuthRuntime,
      resolveImportBackend,
      createCorrelationRef: () => 'correlation-ref',
    })

    for (const query of ['limit=201', 'memberId=private', 'limit=10&limit=20']) {
      const response = await http.detail(
        new Request(`https://place.example/api/imports/${batchId}?${query}`),
        batchId,
      )
      expect(response.status).toBe(400)
    }
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
    expect(resolveImportBackend).not.toHaveBeenCalled()
  })

  it('projects explicit source identity and detail status without internal source keys', async () => {
    const observedQueries: unknown[] = []
    const http = createBrowserImportHttp({
      resolveAuthRuntime: sessionRuntime,
      resolveImportBackend: () => ({
        ready: async () => new Response(), connections: async () => new Response(),
        start: async () => new Response(), cancel: async () => new Response(),
        resume: async () => new Response(), review: async () => new Response(),
        detail: async (_token, _batchId, query) => {
          observedQueries.push(query)
          return Response.json({
          schemaVersion: 'place-import-batch-detail.v1',
          batch: {
            schemaVersion: 'place-import-batch.v1', batchId, connectionId,
            providerKey: 'naver', state: 'completed',
            progress: { discovered: 1, ready: 0, reviewRequired: 0, enriching: 0, applied: 1, skipped: 0, failed: 0 },
            createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:01:00.000Z',
          },
          items: [{
            schemaVersion: 'place-import-item.v1', itemId, batchId,
            providerKey: 'naver', providerPlaceId: 'place-1',
            sourceListId: 'list-1', sourceItemId: 'bookmark-1',
            listName: '여행', name: '장소', address: null, categoryLabel: null,
            location: null, status: 'applied', reviewReasons: [], detailStatus: 'pending',
            sourceItemKey: 'must-not-cross', captureReference: 'must-not-cross',
          }],
          nextCursor: 'next-page',
        }) },
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.detail(
      new Request(`https://place.example/api/imports/${batchId}?cursor=current-page&limit=25`),
      batchId,
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(body).items[0]).toMatchObject({
      providerKey: 'naver', providerPlaceId: 'place-1',
      sourceListId: 'list-1', sourceItemId: 'bookmark-1', detailStatus: 'pending',
    })
    expect(JSON.parse(body).nextCursor).toBe('next-page')
    expect(observedQueries).toEqual([{ cursor: 'current-page', limit: 25 }])
    expect(body).not.toMatch(/sourceItemKey|captureReference|must-not-cross/)
  })

  it('forwards a strict review command and returns a sanitized result', async () => {
    const http = createBrowserImportHttp({
      resolveAuthRuntime: sessionRuntime,
      resolveImportBackend: () => ({
        ready: async () => new Response(), connections: async () => new Response(),
        start: async () => new Response(), detail: async () => new Response(),
        cancel: async () => new Response(), resume: async () => new Response(),
        review: async (token, body) => {
          expect(token).toBe('server-access-token')
          expect(body).toEqual({
            schemaVersion: 'place-import-review.v1', commandId, itemId,
            action: { kind: 'create-place' },
          })
          return Response.json({
            schemaVersion: 'place-import-review-result.v1', commandId, itemId,
            status: 'applied', canonicalPlaceId: batchId, internalDecision: 'hidden',
          })
        },
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.review(new Request('https://place.example/api/import-reviews', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 'place-import-review.v1', commandId, itemId,
        action: { kind: 'create-place' },
      }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      schemaVersion: 'place-import-review-result.v1', commandId, itemId,
      status: 'applied', canonicalPlaceId: batchId,
    })
  })
})

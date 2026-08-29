import { describe, expect, it, vi } from 'vitest'

import { createBrowserWritingHttp } from './browser-writing-http'
import { createWritingBackendClient } from './writing-backend-client'

const placeId = '01992d20-0000-7000-8000-000000000001'
const documentId = '01992d20-0000-7000-8000-000000000002'
const commandId = '01992d20-0000-7000-8000-000000000003'
const at = '2026-08-29T01:30:00.000Z'

function backend(responder: (url: URL, init: RequestInit) => Promise<Response>) {
  return createWritingBackendClient({
    environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
    fetcher: responder,
  })
}

function sessionRuntime() {
  return {
    bff: {
      resolveSession: async () => ({
        id: 'session-id',
        tokens: { accessToken: 'server-access-token', expiresAt: '2026-08-30T00:00:00.000Z' },
        expiresAt: '2026-08-30T00:00:00.000Z',
      }),
    },
  }
}

describe('browser Writing HTTP', () => {
  it('rejects Entry and browser-controlled visibility before authentication', async () => {
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const http = createBrowserWritingHttp({
      resolveAuthRuntime,
      backend: backend(async () => Response.json({})),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.command(new Request('https://place.example/api/writing/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        command: {
          kind: 'create-note', documentId, placeId, body: '메모', visibility: 'public',
        },
      }),
    }))

    expect(response.status).toBe(400)
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
  })

  it('forwards one Place-filtered Note page and owner detail', async () => {
    const observed: string[] = []
    const http = createBrowserWritingHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url) => {
        observed.push(url.toString())
        if (url.pathname.endsWith(documentId)) {
          return Response.json({
            schemaVersion: 'writing-detail.v1',
            document: {
              documentId, kind: 'note', title: null, body: '짧은 메모', visibility: 'private',
              publicationId: null, version: 1, placeIds: [placeId], createdAt: at, updatedAt: at,
            },
          })
        }
        return Response.json({
          schemaVersion: 'writing-list.v1',
          filter: { kind: 'note', placeId },
          items: [{
            documentId, kind: 'note', title: null, bodyPreview: '짧은 메모',
            bodyTruncated: false, visibility: 'private', publicationId: null,
            version: 1, placeIds: [placeId], updatedAt: at,
          }],
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    const list = await http.list(new Request(
      `https://place.example/api/writing?kind=note&placeId=${placeId}&limit=10`,
    ))
    const detail = await http.detail(
      new Request(`https://place.example/api/writing/${documentId}`),
      documentId,
    )

    expect(list.status).toBe(200)
    expect(detail.status).toBe(200)
    expect(observed).toEqual([
      `https://place-backend.example/v1/writing?kind=note&limit=10&placeId=${placeId}`,
      `https://place-backend.example/v1/writing/${documentId}`,
    ])
  })

  it('fails closed when a Writing page is not bound to the requested Place', async () => {
    const http = createBrowserWritingHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        schemaVersion: 'writing-list.v1',
        filter: { kind: 'note' },
        items: [],
      })),
      createCorrelationRef: () => 'safe-correlation',
    })

    const response = await http.list(new Request(
      `https://place.example/api/writing?kind=note&placeId=${placeId}&limit=10`,
    ))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'PLACE_WRITING_WEB_UNAVAILABLE' })
  })

  it('forces a browser Note command to private and preserves applied status', async () => {
    const http = createBrowserWritingHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v1/writing/commands')
        expect(JSON.parse(String(init.body))).toEqual({
          commandId,
          command: {
            kind: 'create-note', documentId, placeId, body: '짧은 메모', visibility: 'private',
          },
        })
        return Response.json({
          schemaVersion: 'writing-command-result.v1', status: 'applied', documentId, version: 1,
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.command(new Request('https://place.example/api/writing/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        command: { kind: 'create-note', documentId, placeId, body: '짧은 메모' },
      }),
    }))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ status: 'applied', version: 1 })
  })

  it('preserves an optimistic version conflict without exposing backend detail', async () => {
    const http = createBrowserWritingHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        type: 'urn:place:error:writing-version-conflict',
        title: 'Writing changed concurrently',
        status: 409,
        code: 'PLACE_WRITING_VERSION_CONFLICT',
        retryable: true,
        correlationRef: 'safe-correlation',
      }, { status: 409, headers: { 'content-type': 'application/problem+json' } })),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.command(new Request('https://place.example/api/writing/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        command: {
          kind: 'update-note', documentId, expectedVersion: 1, placeId, body: '수정 메모',
        },
      }),
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'PLACE_WRITING_VERSION_CONFLICT', correlationRef: 'safe-correlation',
    })
  })
})

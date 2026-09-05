import { describe, expect, it, vi } from 'vitest'

import {
  browserTransferJsonByteLimits,
  createBrowserTransferHttp,
} from './browser-transfer-http'
import { createTransferBackendClient } from './transfer-backend-client'

const connectionId = '01992d20-0000-7000-8000-000000000001'
const commandId = '01992d20-0000-7000-8000-000000000002'
const snapshotId = '01992d20-0000-7000-8000-000000000003'
const collectionId = '01992d20-0000-7000-8000-000000000004'

function backend(responder: (url: URL, init: RequestInit) => Promise<Response>) {
  return createTransferBackendClient({
    environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
    fetcher: responder,
  })
}

function sessionRuntime() {
  return { bff: { resolveSession: async () => ({
    id: 'session-id',
    tokens: { accessToken: 'server-access-token', expiresAt: '2026-09-03T00:00:00.000Z' },
    expiresAt: '2026-09-03T00:00:00.000Z',
  }) } }
}

describe('browser transfer HTTP', () => {
  it('forwards target-list discovery with server-side bearer authority', async () => {
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe(`/v2/transfers/provider-connections/${connectionId}/target-lists`)
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        return Response.json({
          schemaVersion: 'provider-target-list-projection.v2', connectionId,
          availability: 'available', reason: null, targetObservationRevision: 'target-r1',
          items: [{ targetListId: 'remote-list', name: '도쿄 여행', itemCount: 3 }],
        })
      }),
      createCorrelationRef: () => 'unused',
    })
    const response = await http.targetLists(new Request('https://place.example/api/v2/transfers'), connectionId)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ availability: 'available' })
  })

  it('does not call the backend without a browser session', async () => {
    const fetcher = vi.fn()
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      backend: backend(fetcher),
      createCorrelationRef: () => 'correlation-ref',
    })
    const response = await http.connections(new Request('https://place.example/api/v2/transfers/provider-connections'))
    expect(response.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards a shared-link acquisition and preserves the accepted 201 command result', async () => {
    const importSourceId = '01992d20-0000-7000-8000-000000000005'
    const entryId = '01992d20-0000-7000-8000-000000000006'
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v1/transfers/import-acquisitions')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        expect(JSON.parse(String(init.body))).toMatchObject({
          schemaVersion: 'start-import-acquisition.v1', kind: 'shared-links',
          commandId, acquisitionId: commandId, importSourceId, snapshotId,
          links: [{ entryId, position: 0, url: 'https://naver.me/example' }],
        })
        return Response.json({
          schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
          commandId, status: 'applied',
          acquisition: {
            schemaVersion: 'import-acquisition.v1', acquisitionId: commandId,
            acquisitionRevision: 'acquisition-r1', importSourceId, providerKey: 'naver',
            method: 'shared-links', state: 'ready',
            items: [{ entryId, position: 0, state: 'ready', sourceListId: 'source-list', name: '주말 산책', itemCount: 1 }],
            progress: { total: 1, processed: 1, ready: 1, failed: 0 },
            snapshot: { snapshotId, snapshotVersion: 'snapshot-r1' },
            createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:01.000Z',
          },
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.startImportAcquisition(new Request(
      'https://place.example/api/v1/transfers/import-acquisitions',
      {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'start-import-acquisition.v1', kind: 'shared-links',
          commandId, acquisitionId: commandId, importSourceId, snapshotId,
          providerKey: 'naver', links: [{ entryId, position: 0, url: 'https://naver.me/example' }],
        }),
      },
    ))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
      acquisition: { snapshot: { snapshotId } },
    })
  })

  it('authenticates before reading and rejects oversized acquisition input without calling the backend', async () => {
    const fetcher = vi.fn()
    const unauthenticated = createBrowserTransferHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      backend: backend(fetcher), createCorrelationRef: () => 'correlation-ref',
    })
    const request = new Request('https://place.example/api/v1/transfers/import-acquisitions', {
      method: 'POST', headers: {
        'content-type': 'application/json',
        'content-length': String(browserTransferJsonByteLimits.acquisitionRequest + 1),
      }, body: '{}',
    })
    const unauthorized = await unauthenticated.startImportAcquisition(request)
    expect(unauthorized.status).toBe(401)
    expect(request.bodyUsed).toBe(false)

    const authenticated = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(fetcher), createCorrelationRef: () => 'correlation-ref',
    })
    const oversized = await authenticated.startImportAcquisition(new Request(
      'https://place.example/api/v1/transfers/import-acquisitions', {
        method: 'POST', headers: {
          'content-type': 'application/json',
          'content-length': String(browserTransferJsonByteLimits.acquisitionRequest + 1),
        }, body: '{}',
      },
    ))
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toMatchObject({ code: 'PLACE_TRANSFER_REQUEST_TOO_LARGE' })
    expect(fetcher).not.toHaveBeenCalled()

    const streamed = await authenticated.startImportAcquisition(new Request(
      'https://place.example/api/v1/transfers/import-acquisitions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: new ReadableStream({ start(controller) {
          controller.enqueue(new Uint8Array(browserTransferJsonByteLimits.acquisitionRequest))
          controller.enqueue(new Uint8Array(1))
          controller.close()
        } }), duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    ))
    expect(streamed.status).toBe(413)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves the active acquisition limit as a typed 429 rejection', async () => {
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        schemaVersion: 'import-acquisition-command-result.v1', outcome: 'rejected',
        commandId, rejection: { code: 'limit-exceeded' },
      }, { status: 429 })),
      createCorrelationRef: () => 'correlation-ref',
    })
    const response = await http.startImportAcquisition(new Request(
      'https://place.example/api/v1/transfers/import-acquisitions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          schemaVersion: 'start-import-acquisition.v1', kind: 'shared-links',
          commandId, acquisitionId: commandId,
          importSourceId: '01992d20-0000-7000-8000-000000000005', snapshotId,
          providerKey: 'naver', links: [{
            entryId: '01992d20-0000-7000-8000-000000000006',
            position: 0, url: 'https://naver.me/example',
          }],
        }),
      },
    ))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ outcome: 'rejected', rejection: { code: 'limit-exceeded' } })
  })

  it('bounds acquisition responses before parsing them', async () => {
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(browserTransferJsonByteLimits.acquisitionResponse))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      } }), { headers: { 'content-type': 'application/json' } })),
      createCorrelationRef: () => 'correlation-ref',
    })
    const response = await http.importAcquisition(
      new Request('https://place.example/api/v1/transfers/import-acquisitions'), commandId,
    )
    expect(response.status).toBe(503)
  })

  it('forwards v4 import plans while preserving verified source identity', async () => {
    const importSourceId = '01992d20-0000-7000-8000-000000000007'
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v4/transfers/import-plan-commands')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        expect(JSON.parse(String(init.body))).toMatchObject({
          schemaVersion: 'import-plan-command.v4',
          commandId,
        })
        return Response.json({
          schemaVersion: 'import-plan-command-result.v4', outcome: 'accepted',
          commandId, status: 'applied',
          plan: {
            schemaVersion: 'import-plan.v4', planId: commandId, planRevision: 'plan-r1',
            snapshotId, snapshotVersion: 'snapshot-r1', providerKey: 'naver',
            source: { kind: 'verified-connection', importSourceId, connectionId, accountAssurance: 'verified' },
            state: 'draft', approval: { eligible: true, reason: null },
            mappings: [{
              sourceListId: 'source-list', observedName: '도쿄 여행', sourcePosition: 0,
              target: { kind: 'new', collectionId, name: '도쿄 여행' },
              itemCount: 1, unresolvedItemCount: 0,
              preview: {
                addCount: 1, alreadyPresentCount: 0, unresolvedCount: 0, skippedCount: 0,
                items: [{
                  sourceItemId: 'source-item', providerPlaceId: 'provider-place',
                  observedName: '센소지', observedAddress: null, placeId: null,
                  status: 'add', decision: 'policy-create', providerDetailStatus: 'available',
                }],
              },
              materialization: { state: 'pending', collectionRevision: null, rejectionCode: null },
            }],
            createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
          },
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })
    const response = await http.importPlanCommandV4(new Request(
      'https://place.example/api/v4/transfers/import-plan-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'import-plan-command.v4', commandId, kind: 'create',
          planId: commandId, snapshotId, expectedSnapshotVersion: 'snapshot-r1',
          mappings: [{ sourceListId: 'source-list', target: { kind: 'new', collectionId, name: '도쿄 여행' } }],
        }),
      },
    ))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      schemaVersion: 'import-plan-command-result.v4',
      plan: { source: { kind: 'verified-connection', importSourceId, connectionId } },
    })
  })
})

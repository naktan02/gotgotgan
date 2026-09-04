import { describe, expect, it, vi } from 'vitest'

import { createBrowserTransferHttp } from './browser-transfer-http'
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

  it('forwards v3 import plans without changing the versioned contract', async () => {
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v3/transfers/import-plan-commands')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        expect(JSON.parse(String(init.body))).toMatchObject({
          schemaVersion: 'import-plan-command.v3',
          commandId,
        })
        return Response.json({
          schemaVersion: 'import-plan-command-result.v3', outcome: 'accepted',
          commandId, status: 'applied',
          plan: {
            schemaVersion: 'import-plan.v3', planId: commandId, planRevision: 'plan-r1',
            snapshotId, snapshotVersion: 'snapshot-r1', providerKey: 'naver', connectionId,
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
                  status: 'add', decision: 'policy-create',
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
    const response = await http.importPlanCommandV3(new Request(
      'https://place.example/api/v3/transfers/import-plan-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'import-plan-command.v3', commandId, kind: 'create',
          planId: commandId, snapshotId, expectedSnapshotVersion: 'snapshot-r1',
          mappings: [{ sourceListId: 'source-list', target: { kind: 'new', collectionId, name: '도쿄 여행' } }],
        }),
      },
    ))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ schemaVersion: 'import-plan-command-result.v3' })
  })
})

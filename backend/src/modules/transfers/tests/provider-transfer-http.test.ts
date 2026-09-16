import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { registerProviderTransferHttpRoutes } from '../transport/http/register-provider-transfer-http.js'
import type { ProviderCapabilityV2, ProviderTransfers } from '../domain/model.js'
import type { ProductPermission } from '../../../platform/http/product-authorization.js'

const memberId = '01992d41-0000-7000-8000-000000000001'
const connectionId = '01992d41-0000-7000-8000-000000000003'
const transferId = '01992d41-0000-7000-8000-000000000008'
const commandId = '01992d41-0000-7000-8000-000000000101'

const capabilities: readonly ProviderCapabilityV2[] = ['naver', 'google', 'kakao'].map(
  (providerKey) => ({
    providerKey: providerKey as ProviderCapabilityV2['providerKey'],
    displayName: providerKey,
    connections: { availability: 'unavailable', multipleAccounts: true, authMethods: [] },
    importSavedPlaces: {
      availability: 'unavailable', reason: 'source-adapter-unavailable',
    },
    exportCollections: {
      availability: 'unavailable', reason: 'target-adapter-unavailable',
    },
  }),
)

const unavailable = (requestedCommandId: string) => ({
  status: 'rejected' as const,
  commandId: requestedCommandId,
  rejection: { code: 'target-unavailable' as const },
}) satisfies Awaited<ReturnType<ProviderTransfers['applyOutboundTransferCommand']>>

function transfers(): ProviderTransfers {
  return {
    listCapabilities: async () => capabilities,
    listConnections: async () => [],
    applyConnectionCommand: async (_memberId, command) => unavailable(command.commandId),
    listSnapshots: async () => ({ schemaVersion: 'source-snapshot-list.v2', items: [] }),
    getSnapshot: async () => undefined,
    applyImportPlanCommandV2: async (_memberId, command) => unavailable(command.commandId),
    getImportPlanV2: async () => undefined,
    applyImportPlanCommandV3: async (_memberId, command) => unavailable(command.commandId),
    getImportPlanV3: async () => undefined,
    listTargetLists: async () => undefined,
    applyOutboundTransferCommand: async (_memberId, command) => unavailable(command.commandId),
    getOutboundTransfer: async () => undefined,
  }
}

describe('provider transfer HTTP authorization', () => {
  it('rejects import commands from the other contract major before authorization', async () => {
    let authorizationCalls = 0
    const app = Fastify({ logger: false })
    registerProviderTransferHttpRoutes(app, {
      authorizer: async () => {
        authorizationCalls += 1
        return { status: 'authorized', memberId }
      },
      transfers: transfers(),
    })
    const command = {
      kind: 'approve', commandId, planId: transferId,
      expectedPlanRevision: 'import-plan-revision',
    }

    expect((await app.inject({
      method: 'POST', url: '/v2/transfers/import-plan-commands',
      payload: { ...command, schemaVersion: 'import-plan-command.v3' },
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'POST', url: '/v3/transfers/import-plan-commands',
      payload: { ...command, schemaVersion: 'import-plan-command.v2' },
    })).statusCode).toBe(400)
    expect(authorizationCalls).toBe(0)
    await app.close()
  })

  it('uses import scopes for acquisition and library scopes for outbound transfer', async () => {
    const permissions: ProductPermission[] = []
    const app = Fastify({ logger: false })
    registerProviderTransferHttpRoutes(app, {
      authorizer: async (_authorization, permission) => {
        permissions.push(permission)
        return { status: 'authorized', memberId }
      },
      transfers: transfers(),
    })
    const headers = { authorization: 'Bearer member' }

    expect((await app.inject({
      method: 'GET', url: '/v2/transfers/provider-capabilities', headers,
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'GET', url: `/v2/transfers/provider-connections/${connectionId}/target-lists`, headers,
    })).statusCode).toBe(404)
    expect((await app.inject({
      method: 'POST', url: '/v2/transfers/provider-connection-commands', headers,
      payload: {
        schemaVersion: 'provider-connection-command.v2', kind: 'create', commandId,
        connectionId, providerKey: 'naver', label: '개인 네이버', authMethod: 'browser-session',
      },
    })).statusCode).toBe(422)
    expect((await app.inject({
      method: 'POST', url: '/v3/transfers/import-plan-commands', headers,
      payload: {
        schemaVersion: 'import-plan-command.v3', kind: 'approve',
        commandId: '01992d41-0000-7000-8000-000000000103',
        planId: transferId, expectedPlanRevision: 'import-plan-revision',
      },
    })).statusCode).toBe(422)
    expect((await app.inject({
      method: 'POST', url: '/v2/transfers/outbound-transfer-commands', headers,
      payload: {
        schemaVersion: 'outbound-transfer-command.v2', kind: 'approve',
        commandId: '01992d41-0000-7000-8000-000000000102',
        transferId, expectedTransferRevision: 'outbound-revision',
      },
    })).statusCode).toBe(422)

    expect(permissions).toEqual([
      'imports.read', 'library.read', 'imports.write', 'imports.write', 'library.write',
    ])
    await app.close()
  })
})

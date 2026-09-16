import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import type { ImportAcquisitions } from '../domain/acquisitions.js'
import { registerImportAcquisitionHttpRoutes } from '../transport/http/register-import-acquisition-http.js'

const memberId = '01992d41-0000-7000-8000-000000000001'
const commandId = '01992d41-0000-7000-8000-000000000101'
const acquisitionId = '01992d41-0000-7000-8000-000000000102'
const importSourceId = '01992d41-0000-7000-8000-000000000103'
const snapshotId = '01992d41-0000-7000-8000-000000000104'
const entryId = '01992d41-0000-7000-8000-000000000105'

function remoteAcquisition() {
  return {
    schemaVersion: 'import-acquisition.v1' as const,
    acquisitionId,
    acquisitionRevision: '1',
    importSourceId,
    providerKey: 'naver' as const,
    method: 'remote-browser' as const,
    state: 'failed' as const,
    items: [],
    progress: { total: 0, processed: 0, ready: 0, failed: 0 },
    interaction: { state: 'integration-gated' as const },
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  }
}

function acquisitions(): ImportAcquisitions {
  return {
    start: async (_memberId, command) => ({
      schemaVersion: 'import-acquisition-command-result.v1',
      outcome: 'accepted',
      commandId: command.commandId,
      status: 'applied',
      acquisition: remoteAcquisition(),
    }),
    get: async () => remoteAcquisition(),
    applyCommand: async (_memberId, command) => ({
      schemaVersion: 'import-acquisition-command-result.v1',
      outcome: 'rejected',
      commandId: command.commandId,
      rejection: { code: 'not-cancellable' },
    }),
  }
}

describe('web import acquisition HTTP', () => {
  it('publishes provider/method capabilities even when the acquisition runtime is absent', async () => {
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async (authorization) => authorization === undefined
        ? { status: 'authentication-required' } : { status: 'authorized', memberId },
    })
    const denied = await app.inject({ method: 'GET', url: '/v2/transfers/import-acquisition-capabilities' })
    expect(denied.statusCode).toBe(401)
    const response = await app.inject({ method: 'GET', url: '/v2/transfers/import-acquisition-capabilities', headers: { authorization: 'Bearer member' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().providers.map((provider: { providerKey: string }) => provider.providerKey)).toEqual(['naver', 'google', 'kakao'])
    expect(response.json().providers[0].methods[0].availability.status).toBe('configuration-required')
    await app.close()
  })

  it('rejects unsupported v2 providers and every remote method before invoking persistence', async () => {
    let starts = 0
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async () => ({ status: 'authorized', memberId }), remoteBrowserEnabled: true,
      acquisitions: { ...acquisitions(), start: async (...input) => { starts += 1; return acquisitions().start(...input) } },
    })
    for (const providerKey of ['naver', 'google', 'kakao']) {
      for (const kind of ['shared-links', 'remote-browser']) {
        if (providerKey === 'naver' && kind === 'shared-links') continue
        const response = await app.inject({
          method: 'POST', url: '/v2/transfers/import-acquisitions', headers: { authorization: 'Bearer member' },
          payload: {
            schemaVersion: 'start-import-acquisition.v2', kind, commandId, acquisitionId, importSourceId, providerKey,
            ...(kind === 'shared-links' ? { snapshotId, links: [{ entryId, position: 0, url: 'https://example.com/shared' }] } : {}),
          },
        })
        expect(response.statusCode).toBe(422)
        expect(response.json().rejection.code).toBe('capability-unavailable')
      }
    }
    expect(starts).toBe(0)
    await app.close()
  })

  it('routes v2 NAVER links through the unchanged encrypted acquisition boundary', async () => {
    const received: unknown[] = []
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async () => ({ status: 'authorized', memberId }),
      acquisitions: { ...acquisitions(), start: async (owner, command) => { received.push({ owner, command }); return acquisitions().start(owner, command) } },
    })
    const payload = {
      schemaVersion: 'start-import-acquisition.v2', kind: 'shared-links', commandId, acquisitionId, importSourceId, snapshotId, providerKey: 'naver',
      links: [{ entryId, position: 0, url: 'https://naver.me/Example' }],
    }
    const response = await app.inject({ method: 'POST', url: '/v2/transfers/import-acquisitions', headers: { authorization: 'Bearer member' }, payload })
    expect(response.statusCode).toBe(201)
    expect(response.json().schemaVersion).toBe('start-import-acquisition-result.v2')
    expect(received).toEqual([{ owner: memberId, command: { ...payload, schemaVersion: 'start-import-acquisition.v1' } }])
    await app.close()
  })
  it('rejects malformed multi-link input before authorization', async () => {
    let authorizationCalls = 0
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async () => {
        authorizationCalls += 1
        return { status: 'authorized', memberId }
      },
      acquisitions: acquisitions(),
      remoteBrowserEnabled: true,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transfers/import-acquisitions',
      payload: {
        schemaVersion: 'start-import-acquisition.v1',
        kind: 'shared-links',
        commandId,
        acquisitionId,
        importSourceId,
        snapshotId,
        providerKey: 'naver',
        links: [
          { entryId, position: 0, url: 'https://naver.me/TestLink1' },
          { entryId, position: 1, url: 'https://naver.me/duplicate-entry-id' },
        ],
      },
    })
    expect(response.statusCode).toBe(400)
    expect(authorizationCalls).toBe(0)
    await app.close()
  })

  it('authorizes start as a write and readback as a read', async () => {
    const permissions: string[] = []
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async (_authorization, permission) => {
        permissions.push(permission)
        return { status: 'authorized', memberId }
      },
      acquisitions: acquisitions(),
      remoteBrowserEnabled: true,
    })
    const headers = { authorization: 'Bearer member' }
    const start = await app.inject({
      method: 'POST', url: '/v1/transfers/import-acquisitions', headers,
      payload: {
        schemaVersion: 'start-import-acquisition.v1', kind: 'remote-browser',
        commandId, acquisitionId, importSourceId, providerKey: 'naver',
      },
    })
    const read = await app.inject({
      method: 'GET', url: `/v1/transfers/import-acquisitions/${acquisitionId}`, headers,
    })
    expect(start.statusCode).toBe(201)
    expect(read.statusCode).toBe(200)
    expect(permissions).toEqual(['imports.write', 'imports.read'])
    await app.close()
  })

  it('maps the active acquisition limit to HTTP 429', async () => {
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async () => ({ status: 'authorized', memberId }),
      acquisitions: {
        ...acquisitions(),
        start: async (_memberId, command) => ({
          schemaVersion: 'import-acquisition-command-result.v1',
          outcome: 'rejected', commandId: command.commandId,
          rejection: { code: 'limit-exceeded' },
        }),
      },
      remoteBrowserEnabled: true,
    })
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers/import-acquisitions',
      headers: { authorization: 'Bearer member' },
      payload: {
        schemaVersion: 'start-import-acquisition.v1', kind: 'remote-browser',
        commandId, acquisitionId, importSourceId, providerKey: 'naver',
      },
    })
    expect(response.statusCode).toBe(429)
    await app.close()
  })

  it('rejects remote browser startup before persistence unless separately enabled', async () => {
    let startCalls = 0
    const app = Fastify({ logger: false })
    registerImportAcquisitionHttpRoutes(app, {
      authorizer: async () => ({ status: 'authorized', memberId }),
      acquisitions: {
        ...acquisitions(),
        start: async (...input) => {
          startCalls += 1
          return acquisitions().start(...input)
        },
      },
    })
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers/import-acquisitions',
      headers: { authorization: 'Bearer member' },
      payload: {
        schemaVersion: 'start-import-acquisition.v1', kind: 'remote-browser',
        commandId, acquisitionId, importSourceId, providerKey: 'naver',
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      code: 'PLACE_IMPORT_ACQUISITION_REMOTE_BROWSER_DISABLED', retryable: false,
    })
    expect(startCalls).toBe(0)
    await app.close()
  })
})

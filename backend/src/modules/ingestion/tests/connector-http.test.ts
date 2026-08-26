import { createHash } from 'node:crypto'

import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerConnectorHttpRoutes } from '../transport/http/register-connector-http.js'

const applications = new Set<ReturnType<typeof Fastify>>()
const memberId = '01992d31-0000-7000-8000-000000000001'
const operationId = '01992d31-0000-7000-8000-000000000002'
const batchId = '01992d31-0000-7000-8000-000000000003'
const installationId = '01992d31-0000-7000-8000-000000000004'
const idempotencyKey = '01992d31-0000-7000-8000-000000000005'

afterEach(async () => {
  await Promise.all([...applications].map((application) => application.close()))
  applications.clear()
})

function fixture(receiver: unknown) {
  const application = Fastify({ logger: false })
  registerConnectorHttpRoutes(application, {
    authorizer: async (authorization, permission) =>
      authorization === 'Bearer member-token' && permission === 'imports.write'
        ? { status: 'authorized', memberId }
        : { status: 'authentication-required' },
    receiver: receiver as never,
    maximumCaptureRequestBytes: 1_048_576,
  })
  applications.add(application)
  return application
}

describe('connector HTTP boundary', () => {
  it('requires member import authority to issue an origin-bound grant', async () => {
    const issueGrant = vi.fn(async () => ({
      status: 'created' as const,
      grant: {
        schemaVersion: 'place-connector-grant.v1' as const,
        operationId, providerKey: 'naver' as const, operation: 'import-saved-library' as const,
        idempotencyKey, token: 'connector-token-that-is-long-enough-value',
        placeOrigin: 'https://place.example', expiresAt: '2026-08-26T10:05:00.000Z',
        limits: {
          maximumItems: 100, maximumBytes: 10_000,
          maximumBatches: 10, maximumBatchBytes: 5_000,
        },
      },
    }))
    const application = fixture({ issueGrant, submitCapture: vi.fn() })
    const payload = {
      schemaVersion: 'place-connector-grant-request.v1', installationId,
      browserKey: 'whale', providerKey: 'naver', operation: 'import-saved-library',
      idempotencyKey,
    }

    const denied = await application.inject({
      method: 'POST', url: '/v1/connector-grants',
      headers: { 'x-place-public-origin': 'https://place.example' }, payload,
    })
    expect(denied.statusCode).toBe(401)
    expect(issueGrant).not.toHaveBeenCalled()

    const accepted = await application.inject({
      method: 'POST', url: '/v1/connector-grants',
      headers: {
        authorization: 'Bearer member-token',
        'x-place-public-origin': 'https://place.example',
      },
      payload,
    })
    expect(accepted.statusCode).toBe(201)
    expect(issueGrant).toHaveBeenCalledWith({
      memberId, publicOrigin: 'https://place.example', request: payload,
    })
    expect(accepted.headers['cache-control']).toBe('no-store')
  })

  it('authenticates captures only with the scoped connector token', async () => {
    const payload = '{}'
    const checksum = createHash('sha256').update(payload).digest('hex')
    const submitCapture = vi.fn(async () => ({
      status: 'accepted' as const,
      receipt: {
        schemaVersion: 'place-connector-capture-receipt.v1' as const,
        operationId, acceptedSequence: 0, acceptedChecksum: checksum,
        receivedItems: 0, receivedBytes: 2, importBatchId: batchId,
      },
    }))
    const application = fixture({ issueGrant: vi.fn(), submitCapture })
    const batch = {
      schemaVersion: 'place-connector-capture-batch.v1', operationId,
      providerKey: 'naver', sequence: 0, final: true, itemCount: 0,
      contentType: 'application/json', payload, checksum,
    }
    const response = await application.inject({
      method: 'POST', url: '/v1/connector-captures',
      headers: {
        authorization: 'PlaceConnector connector-token-that-is-long-enough-value',
        'x-place-public-origin': 'https://place.example',
      },
      payload: batch,
    })

    expect(response.statusCode).toBe(202)
    expect(submitCapture).toHaveBeenCalledWith({
      token: 'connector-token-that-is-long-enough-value',
      publicOrigin: 'https://place.example', batch,
    })

    const missingGrant = await application.inject({
      method: 'POST', url: '/v1/connector-captures',
      headers: { 'x-place-public-origin': 'https://place.example' },
      payload: batch,
    })
    expect(missingGrant.statusCode).toBe(401)
    expect(missingGrant.headers['www-authenticate']).toBe('PlaceConnector')
    expect(submitCapture).toHaveBeenCalledTimes(1)
  })

  it('returns a connector authentication challenge for an expired grant', async () => {
    const application = fixture({
      issueGrant: vi.fn(),
      submitCapture: vi.fn(async () => ({
        status: 'rejected' as const, reason: 'grant-expired' as const,
      })),
    })
    const payload = '{}'
    const response = await application.inject({
      method: 'POST', url: '/v1/connector-captures',
      headers: {
        authorization: 'PlaceConnector connector-token-that-is-long-enough-value',
        'x-place-public-origin': 'https://place.example',
      },
      payload: {
        schemaVersion: 'place-connector-capture-batch.v1', operationId,
        providerKey: 'naver', sequence: 0, final: true, itemCount: 0,
        contentType: 'application/json', payload,
        checksum: createHash('sha256').update(payload).digest('hex'),
      },
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('PlaceConnector')
    expect(response.json()).toMatchObject({ code: 'PLACE_CONNECTOR_GRANT_INVALID' })
  })
})

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import type { OutboundExecutionControl, TransferOperation } from '../domain/operations.js'
import { registerOutboundExecutionHttpRoutes } from '../transport/http/register-outbound-execution-http.js'

const id = '01992d41-0000-7000-8000-000000000001'
const origin = 'https://app.gotgotgan.test'

const operation: TransferOperation = {
  schemaVersion: 'transfer-operation.v2',
  operationId: id,
  kind: 'outbound-transfer',
  providerKey: 'naver',
  connectionId: id,
  accountLabel: '개인 네이버',
  resource: { kind: 'outbound-transfer', transferId: id },
  stage: 'executing-provider-write',
  state: 'partial-failure',
  progress: { total: 1, processed: 1, applied: 0, failed: 1, outcomeUnknown: 0 },
  operationRevision: 'revision-1',
  attemptCount: 1,
  nextAttemptAt: null,
  actionRequired: null,
  allowedActions: ['cancel'],
  lastError: { code: 'reconciled-absent', retryable: true },
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:01:00.000Z',
  completedAt: null,
}

function reconciliation(phase: 'create-target-list' | 'add-items') {
  return {
    schemaVersion: 'outbound-execution-reconciliation.v2',
    reconciliationId: id,
    operationId: id,
    receiptReference: id,
    attemptId: id,
    phase,
    targetListId: 'provider-list',
    reconciliationReference: 'provider-observation',
    outcome: 'resolved-partial',
    items: [],
  }
}

describe('outbound execution reconciliation HTTP', () => {
  it('rejects partial target-list resolution before persistence', async () => {
    let calls = 0
    const app = Fastify({ logger: false })
    registerOutboundExecutionHttpRoutes(app, {
      authorizer: async () => ({ status: 'authentication-required' }),
      control: {
        recordReconciliation: async () => {
          calls += 1
          return { outcome: 'recorded', operation }
        },
      } as unknown as OutboundExecutionControl,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v2/transfers/outbound-execution-reconciliations',
      headers: { authorization: `PlaceConnector ${'a'.repeat(32)}`, origin },
      payload: reconciliation('create-target-list'),
    })

    expect(response.statusCode).toBe(400)
    expect(calls).toBe(0)
    await app.close()
  })

  it('requires Origin and still accepts partial item-batch resolution', async () => {
    let calls = 0
    const app = Fastify({ logger: false })
    registerOutboundExecutionHttpRoutes(app, {
      authorizer: async () => ({ status: 'authentication-required' }),
      control: {
        recordReconciliation: async () => {
          calls += 1
          return { outcome: 'recorded', operation }
        },
      } as unknown as OutboundExecutionControl,
    })
    const authorization = `PlaceConnector ${'a'.repeat(32)}`
    const payload = reconciliation('add-items')

    expect((await app.inject({
      method: 'POST',
      url: '/v2/transfers/outbound-execution-reconciliations',
      headers: { authorization, 'x-place-public-origin': origin },
      payload,
    })).statusCode).toBe(401)
    expect(calls).toBe(0)

    expect((await app.inject({
      method: 'POST',
      url: '/v2/transfers/outbound-execution-reconciliations',
      headers: { authorization, origin },
      payload,
    })).statusCode).toBe(200)
    expect(calls).toBe(1)
    await app.close()
  })
})

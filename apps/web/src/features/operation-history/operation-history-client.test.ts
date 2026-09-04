import { describe, expect, it } from 'vitest'

import { createOperationHistoryGateway, loadOperationIndicator } from './operation-history-client'

const operationId = '01992d20-0000-7000-8000-000000000101'
const commandId = '01992d20-0000-7000-8000-000000000102'

function operation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'transfer-operation.v2', operationId, kind: 'outbound-transfer',
    providerKey: 'naver', connectionId: '01992d20-0000-7000-8000-000000000103',
    accountLabel: '여행 계정', resource: { kind: 'outbound-transfer', transferId: '01992d20-0000-7000-8000-000000000104' },
    stage: 'preview-approved', state: 'action-required',
    progress: { total: 3, processed: 3, applied: 0, failed: 0, outcomeUnknown: 0 },
    operationRevision: 'operation-r1', attemptCount: 1, nextAttemptAt: null,
    actionRequired: 'consent-required', allowedActions: ['resume', 'cancel'], lastError: null,
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:01:00.000Z', completedAt: null,
    ...overrides,
  }
}

describe('operation history client', () => {
  it('queries durable operations with exact server filters and preserves approval versus completion stages', async () => {
    let url = ''
    const gateway = createOperationHistoryGateway(async (input) => {
      url = String(input)
      return Response.json({ schemaVersion: 'transfer-operation-list.v2', items: [operation()], nextCursor: 'next-page' })
    })
    const page = await gateway.list({ kind: 'outbound-transfer', state: 'action-required' })
    expect(url).toContain('kind=outbound-transfer')
    expect(url).toContain('state=action-required')
    expect(page.items[0]).toMatchObject({ stage: 'preview-approved', state: 'action-required', title: '컬렉션 내보내기' })
    expect(page.nextCursor).toBe('next-page')
  })

  it('sends revision-guarded actions and does not invent a completion result', async () => {
    let body: unknown
    const gateway = createOperationHistoryGateway(async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        schemaVersion: 'transfer-operation-command-result.v2', outcome: 'accepted', commandId,
        status: 'applied', operation: operation({ stage: 'reconciling', state: 'running', allowedActions: [] }),
      })
    })
    const result = await gateway.command({
      commandId, operationId, expectedOperationRevision: 'operation-r1', action: 'reconcile',
    })
    expect(body).toEqual({
      schemaVersion: 'transfer-operation-command.v2', commandId, operationId,
      expectedOperationRevision: 'operation-r1', action: 'reconcile',
    })
    expect(result.operation).toMatchObject({ state: 'running', stage: 'reconciling' })
  })

  it('keeps rejected and authentication responses distinct', async () => {
    const rejected = createOperationHistoryGateway(async () => Response.json({
      schemaVersion: 'transfer-operation-command-result.v2', outcome: 'rejected', commandId,
      rejection: { code: 'revision-conflict' },
    }, { status: 409 }))
    await expect(rejected.command({ commandId, operationId, expectedOperationRevision: 'stale', action: 'retry' }))
      .rejects.toMatchObject({ status: 409, code: 'revision-conflict' })

    const signedOut = createOperationHistoryGateway(async () => Response.json({}, { status: 401 }))
    await expect(signedOut.list({ kind: '', state: '' })).rejects.toMatchObject({ status: 401 })
  })

  it('maps the top-bar summary from the same server projection', async () => {
    const summary = await loadOperationIndicator(async () => Response.json({
      schemaVersion: 'transfer-operation-summary.v2', activeCount: 2,
      attentionCount: 3, actionRequiredCount: 1, outcomeUnknownCount: 1,
      latest: [operation({ stage: 'externally-completed', state: 'completed', completedAt: '2026-09-03T00:02:00.000Z' })],
    }))
    expect(summary).toMatchObject({ activeCount: 2, attentionCount: 3, actionRequiredCount: 1, outcomeUnknownCount: 1 })
    expect(summary.latest[0]).toMatchObject({ stage: 'externally-completed', state: 'completed' })
  })
})

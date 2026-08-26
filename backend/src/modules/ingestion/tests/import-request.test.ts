import { describe, expect, it } from 'vitest'

import {
  ImportRequestConflictError,
  ProviderConnectionUnavailableError,
  requestPlaceImport,
  type ImportRequestStore,
} from '../index.js'

const memberId = '01992d20-7100-7000-8000-000000000001'
const connectionId = '01992d20-7100-7000-8000-000000000002'
const batchId = '01992d20-7100-7000-8000-000000000003'
const jobId = '01992d20-7100-7000-8000-000000000004'
const idempotencyKey = '01992d20-7100-7000-8000-000000000005'

describe('connected-place import request interface', () => {
  it('creates one queued batch and replays the same member command', async () => {
    const commands: unknown[] = []
    const store: ImportRequestStore = {
      requestImport: async (command) => {
        commands.push(command)
        return commands.length === 1
          ? { status: 'created', batch: {
            batchId: command.batchId,
            connectionId: command.connectionId,
            providerKey: 'naver',
            state: 'queued',
            progress: { discovered: 0, ready: 0, reviewRequired: 0, applied: 0, skipped: 0, failed: 0 },
            createdAt: command.requestedAt,
            updatedAt: command.requestedAt,
          } }
          : { status: 'replayed', batch: {
            batchId: command.batchId,
            connectionId: command.connectionId,
            providerKey: 'naver',
            state: 'queued',
            progress: { discovered: 0, ready: 0, reviewRequired: 0, applied: 0, skipped: 0, failed: 0 },
            createdAt: command.requestedAt,
            updatedAt: command.requestedAt,
          } }
      },
    }
    const request = () => requestPlaceImport({
      memberId,
      connectionId,
      idempotencyKey,
      nextBatchId: () => batchId,
      nextJobId: () => jobId,
      now: () => new Date('2026-08-26T11:00:00.000Z'),
      store,
    })

    await expect(request()).resolves.toMatchObject({ status: 'created', batch: { state: 'queued' } })
    await expect(request()).resolves.toMatchObject({ status: 'replayed', batch: { batchId } })
    expect(commands[0]).toMatchObject({
      memberId,
      connectionId,
      idempotencyKey,
      batchId,
      jobId,
      requestedAt: '2026-08-26T11:00:00.000Z',
    })
  })

  it('does not reveal whether a foreign or unavailable connection exists', async () => {
    const store: ImportRequestStore = {
      requestImport: async () => ({ status: 'connection-unavailable' }),
    }
    await expect(requestPlaceImport({
      memberId,
      connectionId,
      idempotencyKey,
      nextBatchId: () => batchId,
      nextJobId: () => jobId,
      now: () => new Date('2026-08-26T11:00:00.000Z'),
      store,
    })).rejects.toBeInstanceOf(ProviderConnectionUnavailableError)
  })

  it('rejects reuse of an idempotency key for another connection', async () => {
    const store: ImportRequestStore = {
      requestImport: async () => ({ status: 'conflict' }),
    }
    await expect(requestPlaceImport({
      memberId,
      connectionId,
      idempotencyKey,
      nextBatchId: () => batchId,
      nextJobId: () => jobId,
      now: () => new Date('2026-08-26T11:00:00.000Z'),
      store,
    })).rejects.toBeInstanceOf(ImportRequestConflictError)
  })
})

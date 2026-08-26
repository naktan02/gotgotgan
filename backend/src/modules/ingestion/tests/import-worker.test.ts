import { describe, expect, it, vi } from 'vitest'

import {
  createImportWorker,
  ImportLeaseLostError,
  type CaptureArtifactStore,
  type ConnectedPlaceSource,
  type ImportWorkerStore,
} from '../index.js'

const claim = {
  jobId: '01992d20-7200-7000-8000-000000000001',
  batchId: '01992d20-7200-7000-8000-000000000002',
  memberId: '01992d20-7200-7000-8000-000000000003',
  connection: {
    connectionId: '01992d20-7200-7000-8000-000000000004',
    providerKey: 'naver' as const,
    profileReference: 'profile:01992d20-7200-7000-8000-000000000005',
  },
  attemptCount: 1,
  cursor: null,
  lease: {
    owner: 'worker-a',
    generation: 1,
    expiresAt: '2026-08-26T11:01:00.000Z',
  },
  cancellationRequestedAt: null,
}

function workerStore(overrides: Partial<ImportWorkerStore> = {}): ImportWorkerStore {
  return {
    claimNext: async () => claim,
    renewLease: async () => true,
    recordPage: async () => ({ status: 'needs-review' }),
    finishAttempt: async () => undefined,
    ...overrides,
  }
}

const captureStore: CaptureArtifactStore = {
  put: async (input) => ({
    reference: `capture:${input.artifactId}`,
    checksum: input.checksum,
  }),
}

describe('acquisition worker interface', () => {
  it('stores one sanitized capture and records provider-neutral preview items', async () => {
    const recorded: unknown[] = []
    const store = workerStore({
      recordPage: async (input) => {
        recorded.push(input)
        return { status: 'needs-review' }
      },
    })
    const source: ConnectedPlaceSource = {
      providerKey: 'naver',
      readPage: async () => ({
        kind: 'page',
        capture: {
          body: new TextEncoder().encode('{"synthetic":true}'),
          checksum: 'a'.repeat(64),
          contentType: 'application/json',
          acquisitionKind: 'structured-web',
          parserVersion: 'naver-saved-place.v1',
          observedAt: '2026-08-26T11:00:00.000Z',
        },
        items: [{
          sourceItemKey: 'list_test_001:bookmark_test_001',
          providerPlaceId: 'place_test_001',
          listName: '테스트 목록',
          name: '테스트 라멘',
          address: '서울 성동구',
          categoryLabel: '라멘',
          location: { latitude: 37.54, longitude: 127.05 },
          reviewReasons: [],
        }],
        nextCursor: null,
      }),
    }
    const ids = [
      '01992d20-7200-7000-8000-000000000010',
      '01992d20-7200-7000-8000-000000000011',
      '01992d20-7200-7000-8000-000000000012',
      '01992d20-7200-7000-8000-000000000013',
      '01992d20-7200-7000-8000-000000000014',
      '01992d20-7200-7000-8000-000000000015',
    ]
    const run = createImportWorker({
      workerId: 'worker-a',
      store,
      captureStore,
      sources: [source],
      nextId: () => ids.shift()!,
      now: () => new Date('2026-08-26T11:00:00.000Z'),
      leaseMilliseconds: 60_000,
      captureRetentionMilliseconds: 86_400_000,
      maximumAttempts: 5,
      retryDelayMilliseconds: () => 1_000,
    })

    const outcome = await run.runOne()
    expect(outcome).toEqual({
      status: 'processed',
      batchId: claim.batchId,
      batchState: 'needs-review',
      itemCount: 1,
    })
    expect(recorded[0]).toMatchObject({
      claim,
      capture: {
        reference: expect.stringMatching(/^capture:/),
        checksum: 'a'.repeat(64),
        parserVersion: 'naver-saved-place.v1',
      },
      items: [{
        sourceItemKey: 'list_test_001:bookmark_test_001',
        itemId: expect.any(String),
        observationId: expect.any(String),
        candidateId: expect.any(String),
        decisionId: expect.any(String),
        proposedPlaceId: expect.any(String),
      }],
    })
    expect(JSON.stringify(outcome)).not.toContain('profile:')
  })

  it.each([
    'provider-auth-expired',
    'provider-mfa-required',
    'provider-captcha-required',
    'provider-consent-required',
    'provider-parser-drift',
  ] as const)('persists %s as user action instead of retrying', async (code) => {
    const finishAttempt = vi.fn(async () => undefined)
    const source: ConnectedPlaceSource = {
      providerKey: 'naver',
      readPage: async () => ({ kind: 'needs-user-action', code }),
    }
    const run = createImportWorker({
      workerId: 'worker-a', store: workerStore({ finishAttempt }), captureStore,
      sources: [source], nextId: () => crypto.randomUUID(),
      now: () => new Date('2026-08-26T11:00:00.000Z'),
      leaseMilliseconds: 60_000, captureRetentionMilliseconds: 86_400_000,
      maximumAttempts: 5, retryDelayMilliseconds: () => 1_000,
    })

    await expect(run.runOne()).resolves.toEqual({
      status: 'needs-user-action', batchId: claim.batchId, code,
    })
    expect(finishAttempt).toHaveBeenCalledWith(expect.objectContaining({
      outcome: { kind: 'needs-user-action', code },
    }))
  })

  it('stops without provider access after cancellation or lost fencing ownership', async () => {
    const sourceRead = vi.fn()
    const source: ConnectedPlaceSource = { providerKey: 'naver', readPage: sourceRead }
    const cancelled = createImportWorker({
      workerId: 'worker-a',
      store: workerStore({ claimNext: async () => ({ ...claim, cancellationRequestedAt: claim.lease.expiresAt }) }),
      captureStore, sources: [source], nextId: () => crypto.randomUUID(),
      now: () => new Date('2026-08-26T11:00:00.000Z'), leaseMilliseconds: 60_000,
      captureRetentionMilliseconds: 86_400_000,
      maximumAttempts: 5, retryDelayMilliseconds: () => 1_000,
    })
    await expect(cancelled.runOne()).resolves.toMatchObject({ status: 'cancelled' })

    const fenced = createImportWorker({
      workerId: 'worker-a', store: workerStore({ renewLease: async () => false }),
      captureStore, sources: [source], nextId: () => crypto.randomUUID(),
      now: () => new Date('2026-08-26T11:00:00.000Z'), leaseMilliseconds: 60_000,
      captureRetentionMilliseconds: 86_400_000,
      maximumAttempts: 5, retryDelayMilliseconds: () => 1_000,
    })
    await expect(fenced.runOne()).resolves.toMatchObject({ status: 'lease-lost' })
    expect(sourceRead).not.toHaveBeenCalled()
  })

  it('discards the result when fencing is lost after provider acquisition', async () => {
    const source: ConnectedPlaceSource = {
      providerKey: 'naver',
      readPage: async () => ({
        kind: 'page',
        capture: {
          body: new TextEncoder().encode('{}'), checksum: 'b'.repeat(64),
          contentType: 'application/json', acquisitionKind: 'browser-network',
          parserVersion: 'naver-saved-place.v1', observedAt: '2026-08-26T11:00:00.000Z',
        },
        items: [], nextCursor: null,
      }),
    }
    const run = createImportWorker({
      workerId: 'worker-a',
      store: workerStore({
        recordPage: async () => { throw new ImportLeaseLostError() },
      }),
      captureStore, sources: [source], nextId: () => crypto.randomUUID(),
      now: () => new Date('2026-08-26T11:00:00.000Z'),
      leaseMilliseconds: 60_000, captureRetentionMilliseconds: 86_400_000,
      maximumAttempts: 5, retryDelayMilliseconds: () => 1_000,
    })
    await expect(run.runOne()).resolves.toEqual({ status: 'lease-lost', batchId: claim.batchId })
  })
})

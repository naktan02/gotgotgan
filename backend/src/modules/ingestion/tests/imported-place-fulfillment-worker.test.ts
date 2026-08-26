import { describe, expect, it, vi } from 'vitest'

import {
  createImportedPlaceFulfillmentWorker,
  type CanonicalPlaceMaterializationPort,
  type ImportedPlaceFulfillmentStore,
  type ImportedPlaceLibraryPort,
  type IngestionStore,
  type PlaceEnrichmentSource,
} from '../index.js'

const at = '2026-08-26T13:00:00.000Z'
const canonicalPlaceId = '01992d20-b000-7000-8000-000000000001'

const claim = {
  jobId: '01992d20-b000-7000-8000-000000000002',
  providerKey: 'naver' as const,
  providerPlaceId: 'naver-place-001',
  attemptCount: 1,
  observationId: '01992d20-b000-7000-8000-000000000003',
  candidateId: '01992d20-b000-7000-8000-000000000004',
  decisionId: '01992d20-b000-7000-8000-000000000005',
  proposedPlaceId: '01992d20-b000-7000-8000-000000000006',
  lease: {
    owner: 'enrichment-worker-a',
    generation: 1,
    expiresAt: '2026-08-26T13:01:00.000Z',
  },
  items: [{
    itemId: '01992d20-b000-7000-8000-000000000010',
    batchId: '01992d20-b000-7000-8000-000000000011',
    memberId: '01992d20-b000-7000-8000-000000000012',
    connectionId: '01992d20-b000-7000-8000-000000000017',
    providerKey: 'naver' as const,
    providerPlaceId: 'naver-place-001',
    sourceListId: 'list-fukuoka',
    sourceListPosition: 0,
    sourcePosition: 0,
    listName: '후쿠오카 여행',
    name: '센카이 라멘',
    address: '일본 후쿠오카현 후쿠오카시',
    categoryLabel: '라멘',
    location: { latitude: 33.5902, longitude: 130.4207 },
    observationId: '01992d20-b000-7000-8000-000000000013',
    candidateId: '01992d20-b000-7000-8000-000000000014',
    decisionId: '01992d20-b000-7000-8000-000000000015',
    proposedPlaceId: '01992d20-b000-7000-8000-000000000016',
    capture: {
      reference: 'capture:member-list',
      checksum: 'a'.repeat(64),
      parserVersion: 'naver-saved-place.v1',
      acquisitionKind: 'browser-network' as const,
      observedAt: at,
    },
  }],
}
const firstItem = claim.items[0]!

function fixture(input: Readonly<{ linked: boolean }>) {
  const appended: unknown[] = []
  const completedItems: unknown[] = []
  const finishedJobs: unknown[] = []
  const store: ImportedPlaceFulfillmentStore = {
    claimNextFulfillment: vi.fn(async () => claim),
    renewFulfillmentLease: vi.fn(async () => true),
    completeFulfillmentItem: vi.fn(async (item) => { completedItems.push(item) }),
    finishFulfillmentJob: vi.fn(async (job) => { finishedJobs.push(job) }),
  }
  const ingestionStore: IngestionStore = {
    append: vi.fn(async (record) => { appended.push(record); return 'recorded' as const }),
  }
  const canonical: CanonicalPlaceMaterializationPort = {
    resolveProviderIdentity: vi.fn(async () => input.linked
      ? { status: 'linked' as const, placeId: canonicalPlaceId }
      : { status: 'not-found' as const }),
    apply: vi.fn(async () => ({ status: 'applied' as const })),
  }
  const library: ImportedPlaceLibraryPort = {
    saveImportedPlace: vi.fn(async () => ({ status: 'applied' as const })),
  }
  const source: PlaceEnrichmentSource = {
    providerKey: 'naver',
    readDetail: vi.fn(async () => ({
      kind: 'detail' as const,
      evidence: {
        checksum: 'b'.repeat(64),
        parserVersion: 'naver-place-detail.v1',
        acquisitionKind: 'structured-web' as const,
        observedAt: at,
      },
      place: {
        name: '센카이 라멘 본점',
        address: '일본 후쿠오카현 후쿠오카시 하카타구',
        categoryLabel: '라멘',
        location: { latitude: 33.5902, longitude: 130.4207 },
        reviewReasons: [],
      },
    })),
  }
  return {
    store, ingestionStore, canonical, library, source,
    appended, completedItems, finishedJobs,
  }
}

function worker(dependencies: ReturnType<typeof fixture>) {
  return createImportedPlaceFulfillmentWorker({
    workerId: 'enrichment-worker-a',
    store: dependencies.store,
    ingestionStore: dependencies.ingestionStore,
    canonical: dependencies.canonical,
    library: dependencies.library,
    sources: [dependencies.source],
    now: () => new Date(at),
    leaseMilliseconds: 60_000,
    maximumAttempts: 5,
    retryDelayMilliseconds: (attempt) => attempt * 1_000,
  })
}

describe('imported place fulfillment worker interface', () => {
  it('saves a linked canonical place without calling provider enrichment', async () => {
    const dependencies = fixture({ linked: true })

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'completed',
      jobId: claim.jobId,
      canonicalPlaceId,
      fulfilled: 1,
    })

    expect(dependencies.source.readDetail).not.toHaveBeenCalled()
    expect(dependencies.canonical.apply).not.toHaveBeenCalled()
    expect(dependencies.library.saveImportedPlace).toHaveBeenCalledWith({
      commandId: firstItem.itemId,
      memberId: firstItem.memberId,
      canonicalPlaceId,
      occurredAt: at,
      source: {
        providerKey: 'naver',
        connectionId: firstItem.connectionId,
        listId: firstItem.sourceListId,
        listName: firstItem.listName,
        listPosition: firstItem.sourceListPosition,
        position: firstItem.sourcePosition,
      },
    })
    expect(dependencies.completedItems).toEqual([expect.objectContaining({
      itemId: firstItem.itemId,
      canonicalPlaceId,
    })])
    expect(dependencies.finishedJobs).toEqual([expect.objectContaining({
      outcome: { kind: 'completed', canonicalPlaceId },
    })])
  })

  it('enriches one missing provider identity once and fulfills every waiting member', async () => {
    const dependencies = fixture({ linked: false })
    const second = {
      ...firstItem,
      itemId: '01992d20-b000-7000-8000-000000000020',
      batchId: '01992d20-b000-7000-8000-000000000021',
      memberId: '01992d20-b000-7000-8000-000000000022',
      observationId: '01992d20-b000-7000-8000-000000000023',
      candidateId: '01992d20-b000-7000-8000-000000000024',
      decisionId: '01992d20-b000-7000-8000-000000000025',
      proposedPlaceId: '01992d20-b000-7000-8000-000000000026',
    }
    dependencies.store.claimNextFulfillment = vi.fn(async () => ({
      ...claim, items: [firstItem, second],
    }))

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'completed',
      jobId: claim.jobId,
      canonicalPlaceId: claim.proposedPlaceId,
      fulfilled: 2,
    })

    expect(dependencies.source.readDetail).toHaveBeenCalledTimes(1)
    expect(dependencies.source.readDetail).toHaveBeenCalledWith({
      providerPlaceId: claim.providerPlaceId,
      signal: expect.any(AbortSignal),
    })
    expect(JSON.stringify(vi.mocked(dependencies.source.readDetail).mock.calls)).not.toMatch(
      /member|profile|cookie|secret/i,
    )
    expect(dependencies.canonical.apply).toHaveBeenCalledTimes(1)
    expect(dependencies.library.saveImportedPlace).toHaveBeenCalledTimes(2)
    expect(dependencies.completedItems).toHaveLength(2)
  })

  it('keeps uncertain enrichment reviewable without canonical or library mutation', async () => {
    const dependencies = fixture({ linked: false })
    dependencies.source.readDetail = vi.fn(async () => ({
      kind: 'detail' as const,
      evidence: {
        checksum: 'd'.repeat(64), parserVersion: 'naver-place-detail.v1',
        acquisitionKind: 'structured-web' as const, observedAt: at,
      },
      place: {
        name: '이름이 비슷한 장소', address: null, categoryLabel: null, location: null,
        reviewReasons: ['missing-address', 'possible-duplicate'],
      },
    }))

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'needs-review', jobId: claim.jobId,
    })

    expect(dependencies.canonical.apply).not.toHaveBeenCalled()
    expect(dependencies.library.saveImportedPlace).not.toHaveBeenCalled()
    expect(dependencies.finishedJobs).toEqual([expect.objectContaining({
      outcome: expect.objectContaining({ kind: 'needs-review' }),
    })])
  })

  it('schedules a bounded retry when provider detail is temporarily unavailable', async () => {
    const dependencies = fixture({ linked: false })
    dependencies.source.readDetail = vi.fn(async () => ({
      kind: 'failure' as const, code: 'provider-unavailable' as const, retryable: true,
    }))

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'retry-scheduled', jobId: claim.jobId, code: 'provider-unavailable',
    })

    expect(dependencies.finishedJobs).toEqual([expect.objectContaining({
      outcome: {
        kind: 'failure', code: 'provider-unavailable', retryable: true,
        retryAt: '2026-08-26T13:00:01.000Z',
      },
    })])
  })
})

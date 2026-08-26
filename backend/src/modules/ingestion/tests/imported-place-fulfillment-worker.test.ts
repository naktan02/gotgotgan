import { describe, expect, it, vi } from 'vitest'

import {
  createImportedPlaceFulfillmentWorker,
  type CanonicalPlaceMaterializationPort,
  type ImportedPlaceFulfillmentStore,
  type ImportedPlaceLibraryPort,
  type IngestionStore,
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
    owner: 'materialization-worker-a',
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
    sourceItemId: 'bookmark-ramen',
    sourceListPosition: 0,
    sourcePosition: 0,
    listName: '후쿠오카 여행',
    name: '라멘 가게',
    address: '일본 후쿠오카',
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
    completeFulfillmentItems: vi.fn(async (items) => { completedItems.push(items) }),
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
  return {
    store, ingestionStore, canonical, library,
    appended, completedItems, finishedJobs,
  }
}

function worker(dependencies: ReturnType<typeof fixture>) {
  return createImportedPlaceFulfillmentWorker({
    workerId: 'materialization-worker-a',
    store: dependencies.store,
    ingestionStore: dependencies.ingestionStore,
    canonical: dependencies.canonical,
    library: dependencies.library,
    now: () => new Date(at),
    leaseMilliseconds: 60_000,
  })
}

describe('imported place materialization worker interface', () => {
  it('saves a linked canonical place from explicit provider provenance', async () => {
    const dependencies = fixture({ linked: true })

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'completed',
      jobId: claim.jobId,
      canonicalPlaceId,
      fulfilled: 1,
    })

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
        itemId: firstItem.sourceItemId,
        providerPlaceId: firstItem.providerPlaceId,
        listName: firstItem.listName,
        listPosition: firstItem.sourceListPosition,
        position: firstItem.sourcePosition,
      },
    })
    expect(dependencies.completedItems).toEqual([expect.objectContaining({
      itemIds: [firstItem.itemId],
      canonicalPlaceId,
    })])
  })

  it('creates one canonical place from the imported snapshot and fulfills every member', async () => {
    const dependencies = fixture({ linked: false })
    const second = {
      ...firstItem,
      itemId: '01992d20-b000-7000-8000-000000000020',
      batchId: '01992d20-b000-7000-8000-000000000021',
      memberId: '01992d20-b000-7000-8000-000000000022',
      sourceListId: 'list-ramen',
      sourceItemId: 'bookmark-ramen-2',
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

    expect(dependencies.canonical.apply).toHaveBeenCalledWith(expect.objectContaining({
      policyVersion: 'connected-import-source-snapshot.v1',
      command: {
        kind: 'create-place',
        placeId: claim.proposedPlaceId,
        providerIdentity: {
          providerKey: claim.providerKey,
          externalPlaceId: claim.providerPlaceId,
        },
      },
    }))
    expect(dependencies.library.saveImportedPlace).toHaveBeenCalledTimes(2)
    expect(dependencies.completedItems).toEqual([expect.objectContaining({
      itemIds: [firstItem.itemId, second.itemId],
      canonicalPlaceId: claim.proposedPlaceId,
    })])
    expect(dependencies.appended).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: claim.observationId, kind: 'source-observation' }),
      expect.objectContaining({ id: claim.candidateId, kind: 'place-candidate' }),
      expect.objectContaining({ id: claim.decisionId, kind: 'resolution-decision' }),
    ]))
  })

  it('does not block a personal save when the source snapshot has no address or coordinates', async () => {
    const dependencies = fixture({ linked: false })
    dependencies.store.claimNextFulfillment = vi.fn(async () => ({
      ...claim,
      items: [{ ...firstItem, address: null, location: null }],
    }))

    await expect(worker(dependencies).runOne()).resolves.toMatchObject({
      status: 'completed', fulfilled: 1,
    })
    expect(dependencies.canonical.apply).toHaveBeenCalledOnce()
    expect(dependencies.library.saveImportedPlace).toHaveBeenCalledOnce()
  })
})

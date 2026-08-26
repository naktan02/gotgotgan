import { describe, expect, it, vi } from 'vitest'

import {
  reviewImportItem,
  type CanonicalPlaceMaterializationPort,
  type ImportedPlaceLibraryPort,
  type ImportReviewStore,
  type IngestionStore,
} from '../index.js'

const at = '2026-08-26T12:00:00.000Z'
const imported = {
  itemId: '01992d20-a000-7000-8000-000000000001',
  batchId: '01992d20-a000-7000-8000-000000000002',
  memberId: '01992d20-a000-7000-8000-000000000003',
  providerKey: 'naver' as const,
  providerPlaceId: 'provider-place-fixture',
  listName: '후쿠오카 여행',
  name: '센카이 라멘',
  address: '일본 후쿠오카현 후쿠오카시',
  categoryLabel: '라멘',
  location: { latitude: 33.5902, longitude: 130.4207 },
  observationId: '01992d20-a000-7000-8000-000000000004',
  candidateId: '01992d20-a000-7000-8000-000000000005',
  decisionId: '01992d20-a000-7000-8000-000000000006',
  proposedPlaceId: '01992d20-a000-7000-8000-000000000007',
  capture: {
    reference: 'capture:fixture', checksum: 'a'.repeat(64),
    parserVersion: 'naver-saved-place.v1', acquisitionKind: 'browser-network' as const,
    observedAt: at,
  },
}

function fixture() {
  const appended: unknown[] = []
  const ingestionStore: IngestionStore = {
    append: vi.fn(async (record) => { appended.push(record); return 'recorded' as const }),
  }
  const complete = vi.fn(async (input) => ({
    status: input.status,
    commandId: input.commandId,
    itemId: input.itemId,
    ...(input.canonicalPlaceId === undefined ? {} : { canonicalPlaceId: input.canonicalPlaceId }),
  }))
  const reviewStore: ImportReviewStore = {
    beginReview: vi.fn(async () => ({ status: 'ready' as const, item: imported })),
    completeReview: complete,
  }
  const canonical: CanonicalPlaceMaterializationPort = {
    resolveProviderIdentity: vi.fn(async () => ({ status: 'not-found' as const })),
    apply: vi.fn(async () => ({ status: 'applied' as const })),
  }
  const library: ImportedPlaceLibraryPort = {
    saveImportedPlace: vi.fn(async () => ({ status: 'applied' as const })),
  }
  return { ingestionStore, reviewStore, canonical, library, appended, complete }
}

describe('import review application', () => {
  it('records evidence before explicit create and saves the resolved place', async () => {
    const dependencies = fixture()
    const commandId = '01992d20-a000-7000-8000-000000000010'
    const result = await reviewImportItem({
      memberId: imported.memberId,
      commandId,
      itemId: imported.itemId,
      action: { kind: 'create-place' },
      occurredAt: at,
      ...dependencies,
    })
    expect(result).toEqual({
      status: 'applied', commandId, itemId: imported.itemId,
      canonicalPlaceId: imported.proposedPlaceId,
    })
    expect(dependencies.appended.map((record: any) => record.kind)).toEqual([
      'source-observation', 'place-candidate', 'resolution-decision',
    ])
    expect(dependencies.canonical.apply).toHaveBeenCalledWith(expect.objectContaining({
      command: {
        kind: 'create-place', placeId: imported.proposedPlaceId,
        providerIdentity: { providerKey: 'naver', externalPlaceId: 'provider-place-fixture' },
      },
    }))
    expect(dependencies.library.saveImportedPlace).toHaveBeenCalledWith({
      commandId, memberId: imported.memberId,
      canonicalPlaceId: imported.proposedPlaceId, occurredAt: at,
    })
  })

  it('links an explicit canonical place and lets skip bypass canonical mutation', async () => {
    const linked = fixture()
    const target = '01992d20-a000-7000-8000-000000000020'
    await reviewImportItem({
      memberId: imported.memberId,
      commandId: '01992d20-a000-7000-8000-000000000021',
      itemId: imported.itemId,
      action: { kind: 'link-place', canonicalPlaceId: target },
      occurredAt: at,
      ...linked,
    })
    expect(linked.canonical.apply).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ kind: 'link-provider-identity', targetPlaceId: target }),
    }))

    const skipped = fixture()
    await reviewImportItem({
      memberId: imported.memberId,
      commandId: '01992d20-a000-7000-8000-000000000022',
      itemId: imported.itemId,
      action: { kind: 'skip', reason: 'not needed' },
      occurredAt: at,
      ...skipped,
    })
    expect(skipped.canonical.apply).not.toHaveBeenCalled()
    expect(skipped.library.saveImportedPlace).not.toHaveBeenCalled()
    expect(skipped.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }))
  })

  it('returns a completed receipt without repeating evidence or side effects', async () => {
    const dependencies = fixture()
    dependencies.reviewStore.beginReview = vi.fn(async () => ({
      status: 'replayed' as const,
      result: {
        status: 'applied' as const,
        commandId: '01992d20-a000-7000-8000-000000000030',
        itemId: imported.itemId,
        canonicalPlaceId: imported.proposedPlaceId,
      },
    }))
    const result = await reviewImportItem({
      memberId: imported.memberId,
      commandId: '01992d20-a000-7000-8000-000000000030',
      itemId: imported.itemId,
      action: { kind: 'create-place' },
      occurredAt: at,
      ...dependencies,
    })
    expect(result.status).toBe('replayed')
    expect(dependencies.appended).toEqual([])
    expect(dependencies.canonical.apply).not.toHaveBeenCalled()
  })
})

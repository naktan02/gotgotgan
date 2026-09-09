import { describe, expect, it, vi } from 'vitest'

import { withProviderListedPlaceContribution } from './provider-listed-place-contribution.js'

const input = {
  decisionId: '00000000-0000-8000-a000-000000000001',
  proposedPlaceId: '00000000-0000-8000-a000-000000000002',
  providerKey: 'naver',
  providerPlaceId: 'provider-place-1',
  sourceObservationId: '00000000-0000-8000-a000-000000000003',
  placeCandidateId: '00000000-0000-8000-a000-000000000004',
  occurredAt: '2026-09-09T00:00:02.000Z',
  snapshotEvidence: {
    acquisitionKind: 'structured-web' as const,
    parserVersion: 'naver-shared-list.v1',
    payloadChecksum: 'a'.repeat(64),
    observedAt: '2026-09-09T00:00:00.000Z',
    acquiredAt: '2026-09-09T00:00:01.000Z',
    name: '내가 붙인 비공개 별명',
    address: '개인 캡처 주소',
    categoryLabel: '개인 분류',
    location: null,
    providerListedFacts: {
      schemaVersion: 'provider-listed-facts.v1' as const,
      name: 'Provider 원본 장소명',
      address: '서울 성동구 공개로 1',
      categoryLabel: '카페',
      location: { latitude: 37.54, longitude: 127.05 },
    },
  },
}

describe('provider-listed place contribution', () => {
  it('publishes only typed Provider facts after canonical resolution', async () => {
    const order: string[] = []
    const materialize = vi.fn(async () => {
      order.push('canonical')
      return { placeId: '00000000-0000-8000-a000-000000000005' }
    })
    const contribute = vi.fn(async () => {
      order.push('catalog')
      return {
        status: 'published' as const,
        current: {
          placeId: '00000000-0000-8000-a000-000000000005',
          revision: 1,
          name: 'Provider 원본 장소명',
          address: '서울 성동구 공개로 1',
          location: { latitude: 37.54, longitude: 127.05 },
          publishedAt: input.snapshotEvidence.acquiredAt,
          policyVersion: 'import-minimum-place-profile.v1',
          taxonomyReferences: [],
        },
      }
    })

    const result = await withProviderListedPlaceContribution(
      { materialize }, { contribute },
    ).materialize(input)

    expect(result).toEqual({ placeId: '00000000-0000-8000-a000-000000000005' })
    expect(order).toEqual(['canonical', 'catalog'])
    expect(contribute).toHaveBeenCalledWith({
      placeId: result.placeId,
      providerKey: 'naver',
      externalPlaceId: 'provider-place-1',
      sourceObservationId: input.sourceObservationId,
      observedAt: input.snapshotEvidence.observedAt,
      recordedAt: input.snapshotEvidence.acquiredAt,
      publicationBasis: 'provider-listed-facts',
      facts: {
        schemaVersion: 'minimum-place-facts.v1',
        name: 'Provider 원본 장소명',
        address: '서울 성동구 공개로 1',
        location: { latitude: 37.54, longitude: 127.05 },
      },
    })
    expect(JSON.stringify(contribute.mock.calls)).not.toContain('내가 붙인 비공개 별명')
    expect(JSON.stringify(contribute.mock.calls)).not.toContain('개인 캡처 주소')
    expect(JSON.stringify(contribute.mock.calls)).not.toContain('개인 분류')
  })

  it('does not publish untyped snapshot facts', async () => {
    const contribute = vi.fn()
    const { providerListedFacts: _providerListedFacts, ...untypedSnapshot } = input.snapshotEvidence
    const materializer = withProviderListedPlaceContribution(
      { materialize: async () => ({ placeId: input.proposedPlaceId }) },
      { contribute },
    )

    await expect(materializer.materialize({
      ...input,
      snapshotEvidence: untypedSnapshot,
    })).resolves.toEqual({ placeId: input.proposedPlaceId })
    expect(contribute).not.toHaveBeenCalled()
  })

  it('does not report the place resolved until catalog contribution succeeds', async () => {
    const materializer = withProviderListedPlaceContribution(
      { materialize: async () => ({ placeId: input.proposedPlaceId }) },
      { contribute: async () => { throw new Error('search projection unavailable') } },
    )

    await expect(materializer.materialize(input)).rejects.toThrow('search projection unavailable')
  })
})

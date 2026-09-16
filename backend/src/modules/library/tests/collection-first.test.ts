import { describe, expect, it } from 'vitest'

import {
  asOpaqueVersion,
  normalizeCollectionOrderMove,
  normalizeImportedCollectionMaterialization,
  normalizePersonalLibraryWorkspaceQuery,
  normalizePersonalRatingChange,
  normalizePlaceFilingMutation,
  normalizePublishedCollectionCopy,
  type CollectionOrder,
  type CollectionOrderReceipt,
  type ImportedCollectionMaterializer,
  type ImportedCollectionReceipt,
  type LibraryWriteResult,
  type LibraryWriteRejection,
  type PersonalLibraryWorkspace,
  type PersonalLibraryWorkspaceView,
  type PersonalRatingLedger,
  type PersonalRatingReceipt,
  type PlaceFiling,
  type PlaceFilingMutation,
  type PlaceFilingReceipt,
  type PublishedCollectionCopyReceipt,
  type PublishedCollectionExchange,
} from '../index.js'

const context = {
  operationId: '01992d00-0000-7000-8000-000000000001',
  memberId: '01992d00-0000-7000-8000-000000000002',
  occurredAt: '2026-09-03T19:00:00+09:00',
}

const collectionVersion = asOpaqueVersion('collection:v17')

describe('Collection-first Library interfaces', () => {
  it('models workspace favorites only as Collection-backed rows', async () => {
    const expected: PersonalLibraryWorkspaceView = {
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: { kind: 'all' },
        ratingFilter: { kind: 'any' },
        tagIds: [],
        tagMatch: 'all',
        areaKeys: [],
        taxonomyKeys: [],
      },
      collections: {
        items: [{
          collectionId: 'ramen',
          name: '서울 라멘',
          description: null,
          visibility: 'private',
          publicationId: null,
          placeCount: 1,
          version: collectionVersion,
          updatedAt: '2026-09-03T10:00:00.000Z',
        }],
      },
      favoritePlaces: {
        items: [{
          placeId: 'ramen-shop',
          collectionMembershipCount: 1,
          tagIds: ['쇼유라멘'],
          personalRating: 4.7,
          place: null,
        }],
      },
      availableFilters: {
        coverage: {
          favoritePlaceCount: 1, sampledPlaceCount: 1,
          projectedPlaceCount: 1, complete: true,
        },
        areas: [], taxonomies: [],
      },
    }
    const workspace: PersonalLibraryWorkspace = {
      openMap: async () => undefined,
      open: async () => expected,
    }

    const result = await workspace.open({
      memberId: context.memberId,
      favoriteScope: { kind: 'all' },
      ratingFilter: { kind: 'any' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 20,
    })

    expect(result).toEqual(expected)
    expect(result!.favoritePlaces.items[0]).not.toHaveProperty('saved')
    expect(result!.favoritePlaces.items[0]).not.toHaveProperty('wanted')
  })

  it('normalizes one-to-fifty explicit filing changes as one atomic method input', async () => {
    const observed: PlaceFilingMutation[] = []
    const result: LibraryWriteResult<PlaceFilingReceipt> = {
      status: 'applied',
      operationId: context.operationId,
      value: {
        placeId: 'ramen-shop',
        collectionMembershipCount: 1,
        personalRating: null,
        collections: [{ collectionId: 'ramen', included: true, version: collectionVersion }],
      },
    }
    const filing: PlaceFiling = {
      open: async () => ({
        schemaVersion: 'place-filing.v2',
        placeId: 'ramen-shop',
        collectionMembershipCount: 0,
        personalRating: null,
        collections: [],
      }),
      apply: async (mutation) => {
        observed.push(mutation)
        return result
      },
    }
    const mutation = normalizePlaceFilingMutation({
      context,
      placeId: 'ramen-shop',
      changes: [{
        collectionId: 'ramen',
        expectedVersion: collectionVersion,
        desired: 'included',
        placement: { kind: 'after', placeId: 'other-shop' },
      }],
    })

    await expect(filing.apply(mutation)).resolves.toEqual(result)
    expect(observed).toHaveLength(1)
    expect(observed[0]?.context.occurredAt).toBe('2026-09-03T10:00:00.000Z')
  })

  it('rejects an empty, oversized, duplicated, or internally inconsistent filing set', () => {
    const base = { context, placeId: 'ramen-shop' }
    expect(() => normalizePlaceFilingMutation({ ...base, changes: [] })).toThrowError(
      expect.objectContaining({ field: 'changes' }),
    )
    expect(() => normalizePlaceFilingMutation({
      ...base,
      changes: Array.from({ length: 51 }, (_, index) => ({
        collectionId: `collection-${index}`,
        expectedVersion: collectionVersion,
        desired: 'included' as const,
      })),
    })).toThrowError(expect.objectContaining({ field: 'changes' }))
    expect(() => normalizePlaceFilingMutation({
      ...base,
      changes: [
        { collectionId: 'ramen', expectedVersion: collectionVersion, desired: 'included' },
        { collectionId: 'ramen', expectedVersion: collectionVersion, desired: 'excluded' },
      ],
    })).toThrowError(expect.objectContaining({ field: 'changes[1].collectionId' }))
    expect(() => normalizePlaceFilingMutation({
      ...base,
      changes: [{
        collectionId: 'ramen',
        expectedVersion: collectionVersion,
        desired: 'excluded',
        placement: { kind: 'last' },
      }],
    })).toThrowError(expect.objectContaining({ field: 'changes[0].placement' }))
  })

  it('uses stable anchor placement without exposing numeric positions', async () => {
    const receipt: LibraryWriteResult<CollectionOrderReceipt> = {
      status: 'replayed',
      operationId: context.operationId,
      value: { collectionId: 'ramen', placeId: 'ramen-shop', version: collectionVersion },
    }
    const order: CollectionOrder = { move: async () => receipt }
    const move = normalizeCollectionOrderMove({
      context,
      collectionId: 'ramen',
      placeId: 'ramen-shop',
      expectedVersion: collectionVersion,
      placement: { kind: 'before', placeId: 'next-shop' },
    })

    await expect(order.move(move)).resolves.toEqual(receipt)
    expect(move.placement).toEqual({ kind: 'before', placeId: 'next-shop' })
    expect(move).not.toHaveProperty('position')
    expect(() => normalizeCollectionOrderMove({
      ...move,
      placement: { kind: 'after', placeId: 'ramen-shop' },
    })).toThrowError(expect.objectContaining({ field: 'placement.placeId' }))
  })

  it('keeps import item array order and validates provider identity independently', async () => {
    const receipt: LibraryWriteResult<ImportedCollectionReceipt> = {
      status: 'applied',
      operationId: context.operationId,
      value: {
        collectionId: 'imported-list',
        version: collectionVersion,
        bindingVersion: asOpaqueVersion('binding:v4'),
        membershipCount: 2,
      },
    }
    const materializer: ImportedCollectionMaterializer = { materialize: async () => receipt }
    const input = normalizeImportedCollectionMaterialization({
      context,
      source: {
        providerKey: 'naver',
        importSourceId: 'connection-1',
        importSourceKind: 'verified-connection',
        connectionId: 'connection-1',
        sourceListId: 'list-1',
        sourcePosition: 2,
        observedName: ' 도쿄 여행 ',
      },
      target: {
        kind: 'existing',
        collectionId: 'shared-travel-list',
        expectedVersion: collectionVersion,
      },
      expectedBindingVersion: asOpaqueVersion('binding:v3'),
      items: [
        {
          sourceItemId: 'source-2',
          providerPlaceId: 'naver-place-b',
          placeId: 'place-b',
          sourcePosition: 8,
        },
        {
          sourceItemId: 'source-1',
          providerPlaceId: 'naver-place-a',
          placeId: 'place-a',
          sourcePosition: 3,
        },
      ],
    })

    await expect(materializer.materialize(input)).resolves.toEqual(receipt)
    expect(input.source.observedName).toBe('도쿄 여행')
    expect(input.items.map((item) => item.placeId)).toEqual(['place-b', 'place-a'])
    expect(input.target).toEqual({
      kind: 'existing',
      collectionId: 'shared-travel-list',
      expectedVersion: collectionVersion,
    })
  })

  it('validates source-list mapping, binding versions, and source positions', () => {
    const base = {
      context,
      source: {
        providerKey: 'google',
        importSourceId: 'connection-2',
        importSourceKind: 'verified-connection' as const,
        connectionId: 'connection-2',
        sourceListId: 'list-2',
        sourcePosition: 0,
        observedName: 'A'.repeat(200),
      },
      target: {
        kind: 'new' as const,
        collectionId: 'travel',
        name: '도쿄 여행',
      },
      items: [{
        sourceItemId: 'item-1',
        providerPlaceId: 'google-place-1',
        placeId: 'place-1',
        sourcePosition: 0,
      }],
    }

    expect(normalizeImportedCollectionMaterialization(base)).toMatchObject({
      source: { observedName: 'A'.repeat(200), sourcePosition: 0 },
      target: { kind: 'new', name: '도쿄 여행' },
    })
    expect(() => normalizeImportedCollectionMaterialization({
      ...base,
      source: { ...base.source, observedName: 'A'.repeat(201) },
    })).toThrowError(expect.objectContaining({ field: 'source.observedName' }))
    expect(() => normalizeImportedCollectionMaterialization({
      ...base,
      target: { ...base.target, name: 'A'.repeat(121) },
    })).toThrowError(expect.objectContaining({ field: 'target.name' }))
    expect(() => normalizeImportedCollectionMaterialization({
      ...base,
      items: [base.items[0]!, { ...base.items[0]!, sourceItemId: 'item-2' }],
    })).toThrowError(expect.objectContaining({ field: 'items[1].sourcePosition' }))
    expect(() => normalizeImportedCollectionMaterialization({
      ...base,
      source: { ...base.source, sourcePosition: -1 },
    })).toThrowError(expect.objectContaining({ field: 'source.sourcePosition' }))
    expect(() => normalizeImportedCollectionMaterialization({
      ...base,
      source: { ...base.source, importSourceKind: 'one-shot' },
    })).toThrowError(expect.objectContaining({ field: 'source' }))
    expect(normalizeImportedCollectionMaterialization({
      ...base,
      source: {
        ...base.source,
        importSourceId: 'shared-link-source',
        importSourceKind: 'one-shot',
        connectionId: null,
      },
    }).source).toMatchObject({
      importSourceId: 'shared-link-source', importSourceKind: 'one-shot', connectionId: null,
    })

    const firstBinding = normalizeImportedCollectionMaterialization({
      ...base,
      target: {
        kind: 'existing',
        collectionId: 'shared-collection',
        expectedVersion: collectionVersion,
      },
    })
    const secondBinding = normalizeImportedCollectionMaterialization({
      ...base,
      source: {
        ...base.source,
        providerKey: 'kakao',
        importSourceId: 'connection-3',
        connectionId: 'connection-3',
        sourceListId: 'list-3',
      },
      target: {
        kind: 'existing',
        collectionId: 'shared-collection',
        expectedVersion: collectionVersion,
      },
    })
    expect([firstBinding.target.collectionId, secondBinding.target.collectionId]).toEqual([
      'shared-collection',
      'shared-collection',
    ])
  })

  it('keeps publication copy and Personal Rating as focused deep modules', async () => {
    const copyReceipt: LibraryWriteResult<PublishedCollectionCopyReceipt> = {
      status: 'applied',
      operationId: context.operationId,
      value: { collectionId: 'copy', version: collectionVersion, copiedPlaceCount: 2 },
    }
    const exchange: PublishedCollectionExchange = {
      setPublication: async () => ({
        status: 'rejected',
        operationId: context.operationId,
        rejection: {
          code: 'version-conflict',
        },
      }),
      copy: async () => copyReceipt,
    }
    const ratingReceipt: LibraryWriteResult<PersonalRatingReceipt> = {
      status: 'replayed',
      operationId: context.operationId,
      value: { placeId: 'ramen-shop', rating: 4.5, version: asOpaqueVersion('rating:v2') },
    }
    const ratings: PersonalRatingLedger = {
      get: async (_memberId, placeId) => ({ placeId, rating: null, version: null }),
      set: async () => ratingReceipt,
    }
    const copy = normalizePublishedCollectionCopy({
      context,
      publicationId: 'publication-1',
      expectedPublicationVersion: asOpaqueVersion('publication:v9'),
      targetCollectionId: 'copy',
      targetName: ' 복사한 도쿄 여행 ',
      selection: { kind: 'places', placeIds: ['place-b', 'place-a'] },
    })
    const rating = normalizePersonalRatingChange({
      context,
      placeId: 'ramen-shop',
      expectedVersion: null,
      rating: 4.5,
    })

    await expect(exchange.copy(copy)).resolves.toEqual(copyReceipt)
    await expect(ratings.set(rating)).resolves.toEqual(ratingReceipt)
    expect(copy.targetName).toBe('복사한 도쿄 여행')
    expect(copy.expectedPublicationVersion).toBe('publication:v9')
    expect(rating).not.toHaveProperty('collectionId')
    expect(() => normalizePublishedCollectionCopy({
      ...copy,
      expectedPublicationVersion: ' ' as typeof collectionVersion,
    })).toThrowError(expect.objectContaining({ field: 'expectedPublicationVersion' }))
  })

  it('treats versions as opaque and bounds workspace pages', () => {
    expect(asOpaqueVersion('not-a-timestamp')).toBe('not-a-timestamp')
    expect(normalizePersonalLibraryWorkspaceQuery({
      memberId: context.memberId,
      favoriteScope: { kind: 'collection', collectionId: 'ramen' },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [],
      limit: 50,
    })).toMatchObject({
      limit: 50, favoriteScope: { kind: 'collection', collectionId: 'ramen' },
    })
    expect(() => normalizePersonalLibraryWorkspaceQuery({
      memberId: context.memberId,
      favoriteScope: { kind: 'all' },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [],
      limit: 51,
    })).toThrowError(expect.objectContaining({ field: 'limit' }))
  })

  it('normalizes search terms and rejects post-normalization expansion or control characters', () => {
    const query = { memberId: context.memberId, favoriteScope: { kind: 'all' } as const,
      ratingFilter: { kind: 'any' } as const, tagIds: [], tagMatch: 'all' as const,
      areaKeys: [], taxonomyKeys: [], limit: 20 }
    expect(normalizePersonalLibraryWorkspaceQuery({ ...query, placeQuery: '  성수동\t ＲＡＭＥＮ  ' }).placeQuery)
      .toBe('성수동 ramen')
    for (const placeQuery of ['x'.repeat(161), '\u0000', 'ﬃ'.repeat(100)]) {
      expect(() => normalizePersonalLibraryWorkspaceQuery({ ...query, placeQuery })).toThrow()
    }
  })

  it('exposes typed applied, replayed, and stable rejected outcomes', () => {
    const outcomes: readonly LibraryWriteResult<PlaceFilingReceipt>[] = [
      {
        status: 'applied',
        operationId: 'one',
        value: {
          placeId: 'p', collectionMembershipCount: 0, personalRating: null, collections: [],
        },
      },
      {
        status: 'replayed',
        operationId: 'one',
        value: {
          placeId: 'p', collectionMembershipCount: 0, personalRating: null, collections: [],
        },
      },
      {
        status: 'rejected',
        operationId: 'one',
        rejection: {
          code: 'operation-id-reused',
        },
      },
    ]

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['applied', 'replayed', 'rejected'])

    const stableRejections: readonly LibraryWriteRejection[] = [
      { code: 'not-found' },
      { code: 'version-conflict' },
      { code: 'operation-id-reused' },
      { code: 'invalid-selection' },
      { code: 'anchor-not-found' },
      { code: 'source-membership-missing' },
      { code: 'collection-limit-exceeded', limit: 100 },
      { code: 'binding-version-conflict' },
      { code: 'publication-changed' },
    ]
    expect(stableRejections).toHaveLength(9)
    expect(stableRejections.every((rejection) => !('resourceId' in rejection))).toBe(true)
  })
})

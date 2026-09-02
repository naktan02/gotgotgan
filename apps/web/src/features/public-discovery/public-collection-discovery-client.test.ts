import { describe, expect, it, vi } from 'vitest'

import { createPublicCollectionDiscoveryGateway } from './public-collection-discovery-client'
import { DiscoveryHttpProblem } from './public-collection-discovery-model'

const publicationId = '01992d20-0000-7000-8000-000000000001'
const placeId = '01992d20-0000-7000-8000-000000000002'
const publicationVersion = 'collection-revision.v1.source'
const at = '2026-09-03T00:00:00.000Z'
const place = {
  placeId,
  position: 0,
  place: {
    placeId,
    name: '도쿄 국립과학박물관',
    areaLabel: '도쿄 · 우에노',
    location: { latitude: 35.7166, longitude: 139.7761 },
    primaryTaxonomy: { key: 'culture.museum', label: '박물관' },
    taxonomyKeys: ['culture.museum'],
    evidence: { status: 'verified', projectedAt: at },
  },
} as const

describe('public Collection discovery client', () => {
  it('sends explicit discovery filters and maps only the public projection', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString(), 'https://place.example')
      expect(url.pathname).toBe('/api/public/collection-directory')
      expect(url.searchParams.get('q')).toBe('도쿄 가족')
      expect(url.searchParams.getAll('areaKeys')).toEqual(['area_abcdefghijklmnopqrstuv'])
      expect(url.searchParams.getAll('taxonomyKeys')).toEqual(['culture.museum'])
      expect(url.searchParams.getAll('topicKeys')).toEqual(['family'])
      expect(url.searchParams.get('sort')).toBe('largest')
      return Response.json({
        schemaVersion: 'public-collection-directory.v2',
        filter: {
          q: '도쿄 가족', areaKeys: ['area_abcdefghijklmnopqrstuv'],
          taxonomyKeys: ['culture.museum'], topicKeys: ['family'], sort: 'largest',
        },
        items: [{
          publicationId, publicationVersion, name: '도쿄 실내 가족 코스',
          description: '비 오는 날 추천', placeCount: 1, updatedAt: at,
          owner: { handle: 'tokyo-curator', displayName: '도쿄새댁 유미' },
          topics: [{ key: 'family', label: '아이와 함께' }], previewPlaces: [place],
        }],
        availableFilters: {
          areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '도쿄', count: 1 }],
          taxonomies: [{ key: 'culture.museum', label: '박물관', count: 1 }],
          topics: [{ key: 'family', label: '아이와 함께', count: 1 }],
        },
      })
    })

    const page = await createPublicCollectionDiscoveryGateway(fetcher).directory({
      query: '도쿄 가족', areaKey: 'area_abcdefghijklmnopqrstuv',
      taxonomyKey: 'culture.museum', topicKey: 'family', sort: 'largest',
    })

    expect(page.items[0]).toMatchObject({
      publicationId,
      publicationVersion,
      previewPlaces: [{ place: { taxonomyLabel: '박물관' } }],
    })
  })

  it('keeps the exact v2 partial-copy command when retrying an unknown result', async () => {
    const bodies: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toBe('/api/library/publication-copy-commands')
      bodies.push(String(init?.body))
      const request = JSON.parse(String(init?.body))
      if (bodies.length === 1) return Response.json({
        type: 'urn:place:error:library-unavailable', title: 'Unavailable', status: 503,
        code: 'PLACE_LIBRARY_UNAVAILABLE', retryable: true, correlationRef: 'copy-ref',
      }, { status: 503 })
      return Response.json({
        schemaVersion: 'published-collection-copy-command-result.v2',
        outcome: 'accepted', receipt: { commandId: request.commandId, status: 'replayed' },
        collectionId: request.target.collectionId,
        collectionRevision: 'collection-revision.v1.target', copiedPlaceCount: 1,
      })
    })
    const gateway = createPublicCollectionDiscoveryGateway(fetcher)
    const attempt = gateway.createCopyAttempt({
      collection: {
        publicationId, publicationVersion, name: '도쿄 실내 가족 코스', description: null,
        placeCount: 1, updatedAt: at,
        owner: { handle: 'tokyo-curator', displayName: '유미' },
        topics: [], previewPlaces: [],
      },
      selection: { kind: 'places', placeIds: [placeId] },
    })

    await expect(attempt.execute()).rejects.toEqual(
      new DiscoveryHttpProblem(503, 'PLACE_LIBRARY_UNAVAILABLE'),
    )
    await expect(attempt.execute()).resolves.toBeUndefined()
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      schemaVersion: 'published-collection-copy-command.v2',
      sourcePublicationId: publicationId,
      expectedPublicationVersion: publicationVersion,
      selection: { kind: 'places', placeIds: [placeId] },
    })
    expect(JSON.parse(bodies[0]!)).not.toHaveProperty('memberId')
  })

  it('preserves authentication and conflict statuses for the UI', async () => {
    const authentication = createPublicCollectionDiscoveryGateway(async () => Response.json({}, { status: 401 }))
    await expect(authentication.report('tokyo-curator', 'spam')).rejects.toMatchObject({ status: 401 })

    const conflict = createPublicCollectionDiscoveryGateway(async () => Response.json({
      schemaVersion: 'published-collection-copy-command-result.v2',
      outcome: 'rejected', commandId: crypto.randomUUID(),
      rejection: { code: 'version-conflict' },
    }, { status: 409 }))
    const attempt = conflict.createCopyAttempt({
      collection: {
        publicationId, publicationVersion, name: '도쿄 실내 가족 코스', description: null,
        placeCount: 1, updatedAt: at,
        owner: { handle: 'tokyo-curator', displayName: '유미' }, topics: [], previewPlaces: [],
      },
      selection: { kind: 'all' },
    })
    await expect(attempt.execute()).rejects.toMatchObject({ status: 409, code: 'version-conflict' })
  })
})

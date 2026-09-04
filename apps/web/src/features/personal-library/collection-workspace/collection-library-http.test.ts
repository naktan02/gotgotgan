import { describe, expect, it, vi } from 'vitest'

import { createCollectionLibraryHttp } from './collection-library-http'

const collectionId = '01992d20-3000-7000-8000-000000000011'
const commandId = '01992d20-3000-7000-8000-000000000021'

describe('Collection-first Library browser client', () => {
  it('serializes one Collection scope without legacy Place states', async () => {
    let requested = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested = String(input)
      return Response.json({
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: { kind: 'collection', collectionId },
        ratingFilter: { kind: 'any' },
        tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      },
      collections: [],
      places: [],
      availableFilters: {
        coverage: { favoritePlaceCount: 0, sampledPlaceCount: 0, projectedPlaceCount: 0, complete: true },
        areas: [], taxonomies: [],
      },
      })
    })
    const client = createCollectionLibraryHttp(fetcher as typeof fetch)

    await client.workspace({
      favoriteScope: { kind: 'collection', collectionId },
      ratingFilter: { kind: 'any' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 20,
    })

    const url = new URL(requested, 'https://gotgotgan.test')
    expect(url.pathname).toBe('/api/library/workspace')
    expect(url.searchParams.get('collectionId')).toBe(collectionId)
    expect(url.searchParams.get('rating')).toBe('any')
    expect(url.searchParams.has('state')).toBe(false)
  })

  it('uses revision-checked v2 commands for Collection lifecycle changes', async () => {
    let body: unknown
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        schemaVersion: 'collection-lifecycle-command-result.v2',
        outcome: 'accepted',
        receipt: { commandId, status: 'applied' },
        collection: null,
      }, { status: 201 })
    })
    const client = createCollectionLibraryHttp(fetcher as typeof fetch)

    await client.collectionCommand({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'delete',
      commandId,
      collectionId,
      expectedCollectionRevision: 'opaque-revision',
    })

    expect(body).toEqual({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'delete',
      commandId,
      collectionId,
      expectedCollectionRevision: 'opaque-revision',
    })
  })
})

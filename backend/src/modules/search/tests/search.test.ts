import { describe, expect, it } from 'vitest'

import {
  InvalidSearchCursorError,
  createPlaceSearch,
  type PlaceSearchSource,
} from '../index.js'

const localResult = {
  placeId: '01992d20-0000-7000-8000-000000000101',
  name: '조용한 라멘 연구소',
  areaLabel: '성수',
  location: { latitude: 37.5445, longitude: 127.056 },
  primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
  taxonomyKeys: ['food.noodle.ramen'],
  evidenceStatus: 'verified' as const,
}

describe('Place search interface', () => {
  it('returns a source-neutral page and preserves each source continuation', async () => {
    const observedCursors: Array<string | undefined> = []
    const local: PlaceSearchSource = {
      sourceKey: 'local',
      search: async (request) => {
        observedCursors.push(request.cursor)
        return { status: 'complete', items: [localResult], nextCursor: 'local-page-2' }
      },
    }
    const search = createPlaceSearch({ sources: [local] })

    const first = await search({
      query: '라멘',
      filters: { taxonomyKeys: ['food.noodle.ramen'] },
      limit: 20,
    })
    expect(first.nextCursor).toBeDefined()
    const second = await search({
      query: '라멘',
      filters: { taxonomyKeys: ['food.noodle.ramen'] },
      limit: 20,
      cursor: first.nextCursor!,
    })

    expect(first.items).toEqual([localResult])
    expect(first.sources).toEqual([
      { sourceKey: 'local', status: 'complete', resultCount: 1 },
    ])
    expect(first.nextCursor).not.toContain('local-page-2')
    expect(observedCursors).toEqual([undefined, 'local-page-2'])
    expect(second.schemaVersion).toBe('place-search.v1')
  })

  it('keeps successful sources when another source is unavailable', async () => {
    const local: PlaceSearchSource = {
      sourceKey: 'local',
      search: async () => ({ status: 'complete', items: [localResult] }),
    }
    const unavailable: PlaceSearchSource = {
      sourceKey: 'provider-test',
      search: async () => { throw new Error('private provider detail') },
    }

    await expect(createPlaceSearch({ sources: [local, unavailable] })({
      query: '라멘', filters: { taxonomyKeys: [] }, limit: 20,
    })).resolves.toEqual({
      schemaVersion: 'place-search.v1',
      items: [localResult],
      sources: [
        { sourceKey: 'local', status: 'complete', resultCount: 1 },
        {
          sourceKey: 'provider-test',
          status: 'unavailable',
          resultCount: 0,
          errorCode: 'PLACE_SEARCH_SOURCE_UNAVAILABLE',
        },
      ],
    })
  })

  it('rejects malformed opaque continuation state', async () => {
    const search = createPlaceSearch({ sources: [] })
    await expect(search({
      query: '', filters: { taxonomyKeys: [] }, limit: 20, cursor: 'not-a-cursor',
    })).rejects.toBeInstanceOf(InvalidSearchCursorError)
  })
})

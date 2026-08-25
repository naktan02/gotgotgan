import { describe, expect, it } from 'vitest'

import {
  InvalidSearchCursorError,
  createPlaceSearch,
  type PlaceSearchResult,
  type PlaceSearchSource,
} from '../index.js'

function result(resultId: string, sourceKey: string = 'local'): PlaceSearchResult {
  return {
    resultId,
    identity: sourceKey === 'local'
      ? { kind: 'canonical', placeId: '01992d20-0000-7000-8000-000000000101' }
      : { kind: 'provider', providerKey: 'google', providerPlaceId: resultId },
    source: {
      key: sourceKey,
      label: sourceKey === 'local' ? '내 장소' : 'Google Maps',
      detailsAvailable: sourceKey !== 'local',
      attributions: sourceKey === 'local' ? [] : [{ label: 'Google Maps' }],
    },
    freshness: { kind: sourceKey === 'local' ? 'indexed' : 'live', observedAt: '2026-08-26T10:00:00.000Z' },
    name: resultId,
    areaLabel: '성수',
    location: { latitude: 37.5445, longitude: 127.056 },
    primaryTaxonomy: null,
    taxonomyKeys: [],
    evidenceStatus: sourceKey === 'local' ? 'verified' : 'unverified',
  }
}

describe('Place search interface', () => {
  it('returns a source-neutral page and preserves each source continuation', async () => {
    const observedCursors: Array<string | undefined> = []
    const local: PlaceSearchSource = {
      sourceKey: 'local',
      search: async (request) => {
        observedCursors.push(request.cursor)
        return { status: 'complete', items: [result('local:one')], nextCursor: 'local-page-2' }
      },
    }
    const search = createPlaceSearch({ sources: [local] })

    const first = await search({ query: '라멘', filters: { taxonomyKeys: [] }, limit: 20 })
    const second = await search({
      query: '라멘', filters: { taxonomyKeys: [] }, limit: 20, cursor: first.nextCursor!,
    })

    expect(first.items).toEqual([result('local:one')])
    expect(first.sources).toEqual([{ sourceKey: 'local', status: 'complete', resultCount: 1 }])
    expect(first.nextCursor).not.toContain('local-page-2')
    expect(observedCursors).toEqual([undefined, 'local-page-2'])
    expect(second.schemaVersion).toBe('place-search.v1')
  })

  it('round-robins source results so one source cannot crowd out the others', async () => {
    const source = (sourceKey: string, items: readonly PlaceSearchResult[]): PlaceSearchSource => ({
      sourceKey,
      search: async () => ({ status: 'complete', items }),
    })
    const search = createPlaceSearch({ sources: [
      source('local', [result('local:1'), result('local:2')]),
      source('google', [result('google:1', 'google'), result('google:2', 'google')]),
    ] })

    const page = await search({ query: '라멘', filters: { taxonomyKeys: [] }, limit: 4 })

    expect(page.items.map((item) => item.resultId)).toEqual([
      'local:1', 'google:1', 'local:2', 'google:2',
    ])
  })

  it('gives the full budget to applicable sources when provider filters are unsupported', async () => {
    const observedLimits: number[] = []
    let providerCalls = 0
    const local: PlaceSearchSource = {
      sourceKey: 'local',
      search: async (request) => {
        observedLimits.push(request.limit)
        return { status: 'complete', items: [result('local:1')] }
      },
    }
    const provider: PlaceSearchSource = {
      sourceKey: 'google',
      accepts: () => false,
      search: async () => {
        providerCalls += 1
        return { status: 'complete', items: [result('google:1', 'google')] }
      },
    }

    const page = await createPlaceSearch({ sources: [local, provider] })({
      query: '라멘', filters: { taxonomyKeys: ['food.noodle.ramen'] }, limit: 20,
    })

    expect(page.items.map((item) => item.resultId)).toEqual(['local:1'])
    expect(observedLimits).toEqual([20])
    expect(providerCalls).toBe(0)
  })

  it('does not rerun exhausted or unavailable sources while a continuation is active', async () => {
    let exhaustedCalls = 0
    let unavailableCalls = 0
    const continuingCursors: Array<string | undefined> = []
    const search = createPlaceSearch({ sources: [
      {
        sourceKey: 'exhausted',
        search: async () => {
          exhaustedCalls += 1
          return { status: 'complete', items: [result('local:1')] }
        },
      },
      {
        sourceKey: 'unavailable',
        search: async () => {
          unavailableCalls += 1
          return { status: 'unavailable', items: [], errorCode: 'PLACE_PROVIDER_RATE_LIMITED' }
        },
      },
      {
        sourceKey: 'continuing',
        search: async (request) => {
          continuingCursors.push(request.cursor)
          return request.cursor === undefined
            ? { status: 'complete', items: [result('google:1', 'google')], nextCursor: 'page-2' }
            : { status: 'complete', items: [result('google:2', 'google')] }
        },
      },
    ] })
    const first = await search({ query: '라멘', filters: { taxonomyKeys: [] }, limit: 6 })
    const second = await search({
      query: '라멘', filters: { taxonomyKeys: [] }, limit: 6, cursor: first.nextCursor!,
    })

    expect(second.items.map((item) => item.resultId)).toEqual(['google:2'])
    expect(exhaustedCalls).toBe(1)
    expect(unavailableCalls).toBe(1)
    expect(continuingCursors).toEqual([undefined, 'page-2'])
  })

  it('keeps successful sources when another source throws private details', async () => {
    const local: PlaceSearchSource = {
      sourceKey: 'local',
      search: async () => ({ status: 'complete', items: [result('local:one')] }),
    }
    const unavailable: PlaceSearchSource = {
      sourceKey: 'provider-test',
      search: async () => { throw new Error('private provider detail') },
    }

    const page = await createPlaceSearch({ sources: [local, unavailable] })({
      query: '라멘', filters: { taxonomyKeys: [] }, limit: 20,
    })

    expect(page.items).toEqual([result('local:one')])
    expect(page.sources).toEqual([
      { sourceKey: 'local', status: 'complete', resultCount: 1 },
      {
        sourceKey: 'provider-test', status: 'unavailable', resultCount: 0,
        errorCode: 'PLACE_SEARCH_SOURCE_UNAVAILABLE',
      },
    ])
    expect(JSON.stringify(page)).not.toContain('private provider detail')
  })

  it('rejects malformed opaque continuation state', async () => {
    const search = createPlaceSearch({ sources: [] })
    await expect(search({
      query: '', filters: { taxonomyKeys: [] }, limit: 20, cursor: 'not-a-cursor',
    })).rejects.toBeInstanceOf(InvalidSearchCursorError)
  })
})

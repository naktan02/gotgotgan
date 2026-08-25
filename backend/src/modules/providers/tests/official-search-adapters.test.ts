import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import {
  GoogleOfficialPlaceDetails,
  GoogleOfficialPlaceSearch,
  KakaoOfficialPlaceSearch,
  NaverOfficialPlaceSearch,
} from '../index.js'
import type { ProviderJsonRequest } from '../adapters/official-http/provider-http.js'

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

const query = {
  query: '성수 라멘', filters: { taxonomyKeys: [] }, limit: 5,
  bounds: { west: 127, south: 37.5, east: 127.1, north: 37.6 },
}

describe('official provider search adapters', () => {
  it('maps the NAVER local response without inventing a provider place ID', async () => {
    const request = vi.fn(async (_input: ProviderJsonRequest) => fixture('naver-local-search'))
    const adapter = new NaverOfficialPlaceSearch({
      endpoint: new URL('https://naver-api.example/local.json'),
      clientId: 'client-id', clientSecret: 'client-secret', timeoutMilliseconds: 2_000,
    }, { request }, () => new Date('2026-08-26T10:00:00.000Z'))

    const page = await adapter.search(query)

    expect(adapter.capabilities).toEqual({
      providerKey: 'naver',
      officialSearch: { maxPageSize: 5, pagination: 'none', bounds: 'client-filtered' },
      placeDetails: 'unsupported', placePhotos: 'unsupported',
    })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        'x-naver-client-id': 'client-id', 'x-naver-client-secret': 'client-secret',
      }),
    }))
    expect(String(request.mock.calls[0]?.[0].url)).toContain('query=%EC%84%B1%EC%88%98+%EB%9D%BC%EB%A9%98')
    expect(page.items[0]).toMatchObject({
      identity: { kind: 'provider', providerKey: 'naver' },
      name: '성수 라멘 연구소',
      location: { latitude: 37.5445, longitude: 127.056 },
      source: { key: 'naver', detailsAvailable: false, categoryLabel: '음식점>일식>라멘' },
      primaryTaxonomy: null, taxonomyKeys: [], evidenceStatus: 'unverified',
    })
    expect(page.items[0]?.identity).not.toHaveProperty('providerPlaceId')
  })

  it('maps Kakao bounds and continuation while retaining its documented place ID', async () => {
    const request = vi.fn(async (_input: ProviderJsonRequest) => fixture('kakao-keyword-search'))
    const adapter = new KakaoOfficialPlaceSearch({
      endpoint: new URL('https://kakao-api.example/search/keyword.json'),
      restApiKey: 'rest-api-key', timeoutMilliseconds: 2_000,
    }, { request }, () => new Date('2026-08-26T10:00:00.000Z'))

    const page = await adapter.search(query)

    expect(adapter.capabilities.officialSearch).toEqual({
      maxPageSize: 15, pagination: 'page', bounds: 'server-rectangle',
    })
    const requested = request.mock.calls[0]?.[0]
    expect(String(requested?.url)).toContain('rect=127%2C37.5%2C127.1%2C37.6')
    expect(requested?.headers.authorization).toBe('KakaoAK rest-api-key')
    expect(page.nextCursor).toBe('2')
    expect(page.items[0]).toMatchObject({
      identity: { kind: 'provider', providerKey: 'kakao', providerPlaceId: 'kakao-place-100' },
      source: { key: 'kakao', detailsAvailable: false },
    })
  })

  it('uses the Google field mask, viewport, page token, and lazy detail/photo calls', async () => {
    const responses = [
      await fixture('google-text-search'),
      await fixture('google-place-details'),
      { photoUri: 'https://photos.google.example/media/100' },
    ]
    const request = vi.fn(async (_input: ProviderJsonRequest) => responses.shift())
    const config = {
      baseUrl: new URL('https://places-api.example/v1/'),
      apiKey: 'google-key', timeoutMilliseconds: 2_000,
    }
    const adapter = new GoogleOfficialPlaceSearch(config, { request }, () => new Date('2026-08-26T10:00:00.000Z'))
    const details = new GoogleOfficialPlaceDetails(config, { request }, () => new Date('2026-08-26T10:01:00.000Z'))

    const page = await adapter.search({ ...query, cursor: 'google-page-1' })
    const detail = await details.get({ providerKey: 'google', providerPlaceId: 'google-place-100' })

    expect(adapter.capabilities).toMatchObject({
      providerKey: 'google', placeDetails: 'supported', placePhotos: 'supported',
    })
    expect(request.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      method: 'POST',
      url: new URL('https://places-api.example/v1/places:searchText'),
      headers: expect.objectContaining({ 'x-goog-api-key': 'google-key' }),
      body: expect.objectContaining({
        textQuery: '성수 라멘', pageToken: 'google-page-1',
        locationRestriction: { rectangle: { low: { latitude: 37.5, longitude: 127 }, high: { latitude: 37.6, longitude: 127.1 } } },
      }),
    }))
    expect(request.mock.calls[0]?.[0].headers['x-goog-fieldmask']).toContain('places.id')
    expect(page.nextCursor).toBe('google-page-2')
    expect(page.items[0]?.source.detailsAvailable).toBe(true)
    expect(detail).toMatchObject({
      schemaVersion: 'place-provider-detail.v1', providerKey: 'google',
      providerPlaceId: 'google-place-100', rating: 4.6, userRatingCount: 120,
      photos: [{
        mediaUri: 'https://photos.google.example/media/100',
        authorAttributions: [{ label: '사진 작성자' }],
      }],
      attributions: [{ label: 'Google Maps' }],
    })
    expect(String(request.mock.calls[1]?.[0].url)).toContain('/v1/places/google-place-100')
    expect(String(request.mock.calls[2]?.[0].url)).toContain('/photos/photo-100/media')
  })

  it('does not call external providers for blank, personal, or unmapped taxonomy queries', async () => {
    const request = vi.fn(async (_input: ProviderJsonRequest): Promise<unknown> => undefined)
    const adapter = new KakaoOfficialPlaceSearch({
      endpoint: new URL('https://kakao-api.example/search/keyword.json'),
      restApiKey: 'rest-api-key', timeoutMilliseconds: 2_000,
    }, { request }, () => new Date())

    await expect(adapter.search({ query: ' ', filters: { taxonomyKeys: [] }, limit: 5 }))
      .resolves.toEqual({ status: 'complete', items: [] })
    await expect(adapter.search({ query: '라멘', filters: { taxonomyKeys: [], saved: true }, limit: 5 }))
      .resolves.toMatchObject({ status: 'partial', errorCode: 'PLACE_PROVIDER_FILTER_UNSUPPORTED' })
    await expect(adapter.search({ query: '라멘', filters: { taxonomyKeys: ['food.noodle.ramen'] }, limit: 5 }))
      .resolves.toMatchObject({ status: 'partial', errorCode: 'PLACE_PROVIDER_FILTER_UNSUPPORTED' })
    expect(request).not.toHaveBeenCalled()
  })
})

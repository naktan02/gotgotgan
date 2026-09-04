import { describe, expect, it, vi } from 'vitest'

import { createBrowserPublicationHttp } from './browser-publication-http'
import {
  PublicationNotFoundError,
  PublicPlaceRetiredError,
} from './publication-backend-client'

function dependencies() {
  return {
    getCollection: vi.fn(async () => ({ publicationId: 'collection-1', name: '공개 목록' })),
    getDirectory: vi.fn(async () => ({ items: [] })),
    getDiscoverable: vi.fn(async () => ({ publicationId: 'collection-1', places: [] })),
    getCollectionMap: vi.fn(async () => ({ publicationId: 'collection-1', features: [] })),
    getPlace: vi.fn(async () => ({ placeId: 'place-1', name: '공개 장소' })),
    getWriting: vi.fn(async () => ({ publicationId: 'writing-1', body: '공개 글' })),
    createCorrelationRef: () => 'publication-ref',
  }
}

describe('browser publication HTTP', () => {
  it('forwards only validated public discovery filters, including repeated facets', async () => {
    const configured = dependencies()
    const request = new Request(
      'http://place.test/api/public/collection-directory?q=%EB%8F%84%EC%BF%84&areaKeys=area_abcdefghijklmnopqrstuv&taxonomyKeys=culture.museum&topicKeys=family&sort=largest&limit=20',
    )
    const response = await createBrowserPublicationHttp(configured).directory(request)

    expect(response.status).toBe(200)
    expect(configured.getDirectory).toHaveBeenCalledWith({
      q: '도쿄', areaKeys: ['area_abcdefghijklmnopqrstuv'], taxonomyKeys: ['culture.museum'],
      topicKeys: ['family'], sort: 'largest', limit: 20,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects unknown discovery filters before calling the Backend', async () => {
    const configured = dependencies()
    const response = await createBrowserPublicationHttp(configured).directory(new Request(
      'http://place.test/api/public/collection-directory?visibility=unlisted',
    ))

    expect(response.status).toBe(400)
    expect(configured.getDirectory).not.toHaveBeenCalled()
  })

  it('validates and forwards a discoverable Collection page', async () => {
    const configured = dependencies()
    const publicationId = '01992d20-0000-7000-8000-000000000001'
    const response = await createBrowserPublicationHttp(configured).discoverable(
      publicationId,
      new Request(`http://place.test/api/public/discoverable-collections/${publicationId}?cursor=page-2&limit=30`),
    )

    expect(response.status).toBe(200)
    expect(configured.getDiscoverable).toHaveBeenCalledWith(
      publicationId,
      { cursor: 'page-2', limit: 30 },
    )
  })

  it('serves allowlisted projections with the shared public cache policy', async () => {
    const configured = dependencies()
    const publicationId = '01992d20-0000-7000-8000-000000000001'
    const response = await createBrowserPublicationHttp(configured).collection(
      publicationId,
      new Request(`http://place.test/api/public/collections/${publicationId}?limit=50`),
    )

    expect(configured.getCollection).toHaveBeenCalledWith(publicationId, { limit: 50 })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('maps absence to one non-reflective 404 problem', async () => {
    const configured = dependencies()
    configured.getWriting.mockRejectedValueOnce(new PublicationNotFoundError('private detail'))
    const response = await createBrowserPublicationHttp(configured).writing('private-writing')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      type: 'urn:place:error:publication-not-found',
      title: 'Publication not found', status: 404,
      code: 'PLACE_PUBLICATION_NOT_FOUND', retryable: false, correlationRef: 'publication-ref',
    })
    expect(response.headers.get('content-type')).toContain('application/problem+json')
  })

  it('maps unexpected failures to a retryable 503 problem', async () => {
    const configured = dependencies()
    configured.getCollection.mockRejectedValueOnce(new Error('internal address'))
    const publicationId = '01992d20-0000-7000-8000-000000000001'
    const response = await createBrowserPublicationHttp(configured).collection(
      publicationId,
      new Request(`http://place.test/api/public/collections/${publicationId}`),
    )

    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('internal address')
  })

  it('forwards antimeridian map bounds and rejects an empty longitude interval', async () => {
    const configured = dependencies()
    const publicationId = '01992d20-0000-7000-8000-000000000001'
    const http = createBrowserPublicationHttp(configured)
    const crossing = await http.collectionMap(
      publicationId,
      new Request(`http://place.test/api/public/collections/${publicationId}/map?west=127&south=37.5&east=126&north=37.6&zoom=12`),
    )
    const empty = await http.collectionMap(
      publicationId,
      new Request(`http://place.test/api/public/collections/${publicationId}/map?west=127&south=37.5&east=127&north=37.6&zoom=12`),
    )

    expect(crossing.status).toBe(200)
    expect(configured.getCollectionMap).toHaveBeenCalledWith(publicationId, {
      west: 127, south: 37.5, east: 126, north: 37.6, zoom: 12,
    })
    expect(empty.status).toBe(400)
    expect(configured.getCollectionMap).toHaveBeenCalledOnce()
  })

  it('validates public Place identity and preserves retired semantics', async () => {
    const configured = dependencies()
    const http = createBrowserPublicationHttp(configured)
    const invalid = await http.place('not-a-place')

    expect(invalid.status).toBe(404)
    expect(configured.getPlace).not.toHaveBeenCalled()

    configured.getPlace.mockRejectedValueOnce(new PublicPlaceRetiredError('private lifecycle'))
    const retired = await http.place('01992d20-0000-7000-8000-000000000003')
    expect(retired.status).toBe(410)
    expect(await retired.json()).toMatchObject({
      code: 'PLACE_RETIRED', retryable: false,
    })
  })
})

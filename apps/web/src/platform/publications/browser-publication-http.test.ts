import { describe, expect, it, vi } from 'vitest'

import { createBrowserPublicationHttp } from './browser-publication-http'
import { PublicationNotFoundError } from './publication-backend-client'

function dependencies() {
  return {
    getCollection: vi.fn(async () => ({ publicationId: 'collection-1', name: '공개 목록' })),
    getCollectionMap: vi.fn(async () => ({ publicationId: 'collection-1', features: [] })),
    getWriting: vi.fn(async () => ({ publicationId: 'writing-1', body: '공개 글' })),
    createCorrelationRef: () => 'publication-ref',
  }
}

describe('browser publication HTTP', () => {
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

  it('validates map bounds before calling the Backend', async () => {
    const configured = dependencies()
    const publicationId = '01992d20-0000-7000-8000-000000000001'
    const response = await createBrowserPublicationHttp(configured).collectionMap(
      publicationId,
      new Request(`http://place.test/api/public/collections/${publicationId}/map?west=127&south=37.5&east=126&north=37.6&zoom=12`),
    )

    expect(response.status).toBe(400)
    expect(configured.getCollectionMap).not.toHaveBeenCalled()
  })
})

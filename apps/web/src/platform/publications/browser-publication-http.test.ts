import { describe, expect, it, vi } from 'vitest'

import { createBrowserPublicationHttp } from './browser-publication-http'
import { PublicationNotFoundError } from './publication-backend-client'

function dependencies() {
  return {
    getCollection: vi.fn(async () => ({ publicationId: 'collection-1', name: '공개 목록' })),
    getWriting: vi.fn(async () => ({ publicationId: 'writing-1', body: '공개 글' })),
    createCorrelationRef: () => 'publication-ref',
  }
}

describe('browser publication HTTP', () => {
  it('serves allowlisted projections with the shared public cache policy', async () => {
    const configured = dependencies()
    const response = await createBrowserPublicationHttp(configured).collection('collection-1')

    expect(configured.getCollection).toHaveBeenCalledWith('collection-1')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
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
    const response = await createBrowserPublicationHttp(configured).collection('collection-1')

    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('internal address')
  })
})

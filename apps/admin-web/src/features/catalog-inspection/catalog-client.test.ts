import { describe, expect, it, vi } from 'vitest'
import { createCatalogClient } from './catalog-client'

describe('Admin catalog client', () => {
  it('keeps pagination and cancellation inside the same-origin catalog route', async () => {
    const page = { schemaVersion: 'catalog-place-search.v1', interpretation: { normalizedQuery: '서울', tokens: [] }, items: [], mapBounds: null, nextCursor: 'next' }
    const request = vi.fn().mockResolvedValue(Response.json(page))
    const signal = new AbortController().signal
    expect(await createCatalogClient(request).search('서울', 'previous', signal)).toEqual(page)
    expect(request.mock.calls[0][0]).toBe('/api/admin/catalog')
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', signal })
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ query: '서울', cursor: 'previous', limit: 20 })
  })
  it('sanitizes server failure messages', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ detail: 'secret endpoint' }, { status: 503 }))
    await expect(createCatalogClient(request).search('', undefined, new AbortController().signal)).rejects.toThrow('조회에 실패했습니다.')
  })
})

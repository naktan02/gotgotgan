import { describe, expect, it, vi } from 'vitest'
import { catalogInteractionHttp } from './catalog-interactions-http'

const request = (body: unknown) => new Request('http://localhost/api/search/catalog/explore', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
describe('catalog interaction browser boundary', () => {
  it('transports v2 regional points only through the versioned fixed endpoint', async () => {
    const body = { schemaVersion: 'catalog-exploration.v2', intent: 'name', places: [], conditions: [], unrecognizedText: '',
      destinations: [{ key: 'geonames:1841610', name: '경기도', kind: 'administrative-area', countryCode: 'KR',
        location: { latitude: 37.6, longitude: 127.25 }, bounds: null, exact: true }] }
    const fetcher = vi.fn(async () => Response.json(body))
    const input = { schemaVersion: 'catalog-exploration.v2', query: '경기도' }
    const response = await catalogInteractionHttp('exploreV2', request(input), { PLACE_BACKEND_ORIGIN: 'http://backend:3001' }, fetcher)
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledWith(new URL('http://backend:3001/v2/search/catalog/explore'), expect.objectContaining({ redirect: 'error', cache: 'no-store' }))
    const legacy = await catalogInteractionHttp('explore', request({ ...input, schemaVersion: 'catalog-exploration.v1' }), { PLACE_BACKEND_ORIGIN: 'http://backend:3001' }, fetcher)
    expect(legacy.status).toBe(503)
    const invalid = await catalogInteractionHttp('exploreV2', request({ ...input, url: 'http://127.0.0.1' }), {}, fetcher)
    expect(invalid.status).toBe(400)
  })
  it('rejects unknown input without forwarding or following a caller URL', async () => {
    const fetcher = vi.fn()
    const response = await catalogInteractionHttp('explore', request({ schemaVersion: 'catalog-exploration.v1', query: '서울', url: 'http://127.0.0.1' }), {}, fetcher)
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses the fixed internal endpoint and validates its output', async () => {
    const body = { schemaVersion: 'catalog-exploration.v1', intent: 'name', destinations: [], places: [], conditions: [], unrecognizedText: '하쿠텐' }
    const fetcher = vi.fn(async () => Response.json(body))
    const response = await catalogInteractionHttp('explore', request({ schemaVersion: 'catalog-exploration.v1', query: '하쿠텐' }), { PLACE_BACKEND_ORIGIN: 'http://backend:3001' }, fetcher)
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledWith(new URL('http://backend:3001/v1/search/catalog/explore'), expect.objectContaining({ redirect: 'error', cache: 'no-store' }))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

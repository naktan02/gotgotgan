import { describe, expect, it, vi } from 'vitest'
import { createAdminCatalogHttp } from './catalog-http'

const placeId = '01992d20-0000-7000-8000-000000000001'
const empty = { schemaVersion: 'catalog-place-search.v1',
  interpretation: { normalizedQuery: '', tokens: [] }, items: [], mapBounds: null }
const detail = { schemaVersion: 'place-detail.v1', requestedPlaceId: placeId, placeId,
  redirectedFrom: [], status: 'available', name: '테스트 장소', areaLabel: null, location: null,
  primaryTaxonomy: null, taxonomyKeys: [], evidence: { status: 'unverified', projectedAt: '2026-09-05T00:00:00.000Z' } }
const searchRequest = (body: unknown = { schemaVersion: 'catalog-place-search.v1', query: '라멘' }, origin = 'https://admin.example') =>
  new Request('https://admin.example/api/admin/catalog', { method: 'POST',
    headers: { origin, 'content-type': 'application/json', authorization: 'Bearer browser-spoof', cookie: 'private-cookie' }, body: JSON.stringify(body) })
function setup(body: unknown = empty, status = 200) {
  const request = vi.fn().mockResolvedValue(Response.json(body, { status }))
  const authorize = vi.fn().mockResolvedValue(Response.json({ accepted: true }))
  return { request, authorize, http: createAdminCatalogHttp({ authorize,
    backendOrigin: () => 'https://backend.example', request }) }
}
describe('Admin public catalog BFF', () => {
  it.each([401, 403, 503])('never reads the catalog when current Admin authorization returns %s', async (status) => {
    const { authorize, request, http } = setup()
    authorize.mockResolvedValue(Response.json({}, { status }))
    expect((await http.search(searchRequest())).status).toBe(status)
    expect((await http.detail(new Request('https://admin.example/api/admin/catalog/x'), placeId)).status).toBe(status)
    expect(request).not.toHaveBeenCalled()
  })
  it('calls only fixed internal catalog search without credentials and validates its projection', async () => {
    const { http, request } = setup()
    const response = await http.search(searchRequest())
    expect(await response.json()).toEqual(empty)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://backend.example/v1/search/catalog')
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(init.headers).not.toHaveProperty('authorization')
    expect(init.headers).not.toHaveProperty('cookie')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body)).toMatchObject({ query: '라멘', limit: 20 })
  })
  it('rejects cross-origin calls and unexpected role/provider/endpoint fields before fetching', async () => {
    const { http, request } = setup()
    expect((await http.search(searchRequest(undefined, 'https://evil.example'))).status).toBe(403)
    expect((await http.search(searchRequest({ schemaVersion: 'catalog-place-search.v1', query: '', role: 'owner', provider: 'naver' }))).status).toBe(400)
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON as a client error', async () => {
    const { http } = setup()
    expect((await http.search(new Request('https://admin.example/api/admin/catalog', {
      method: 'POST', headers: { origin: 'https://admin.example' }, body: '{',
    }))).status).toBe(400)
  })
  it('cancels an oversized streaming request before reading the remainder', async () => {
    const { http, request } = setup()
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(8_193))
    }, cancel })
    const incoming = new Request('https://admin.example/api/admin/catalog', {
      method: 'POST', headers: { origin: 'https://admin.example' }, body: stream, duplex: 'half',
    } as RequestInit)
    expect((await http.search(incoming)).status).toBe(400)
    expect(cancel).toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
  it('reads canonical detail with no bearer and rejects private overlays', async () => {
    const { http, request } = setup(detail)
    const incoming = new Request(`https://admin.example/api/admin/catalog/${placeId}`)
    expect(await (await http.detail(incoming, placeId)).json()).toEqual(detail)
    expect(String(request.mock.calls[0][0])).toBe(`https://backend.example/v1/places/${placeId}`)
    request.mockResolvedValue(Response.json({ ...detail, personalState: { saved: true } }))
    expect((await http.detail(incoming, placeId)).status).toBe(503)
  })
  it('does not accept arbitrary path IDs or query arguments', async () => {
    const { http, request } = setup()
    expect((await http.detail(new Request('https://admin.example/api/admin/catalog/x'), '../../internal')).status).toBe(400)
    expect((await http.detail(new Request('https://admin.example/api/admin/catalog/x?owner=someone'), placeId)).status).toBe(400)
    expect(request).not.toHaveBeenCalled()
  })
  it.each([404, 410])('preserves unavailable-place status %s without relaying internal failures', async (status) => {
    const { http } = setup({ secret: 'provider-cookie' }, status)
    const response = await http.detail(new Request('https://admin.example/api/admin/catalog/x'), placeId)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('provider-cookie')
  })
  it('fails closed for external result shape or malformed configuration', async () => {
    const { http } = setup({ ...empty, providerResults: [] })
    expect((await http.search(searchRequest())).status).toBe(503)
    const request = vi.fn()
    const invalid = createAdminCatalogHttp({ authorize: async () => Response.json({}),
      backendOrigin: () => 'https://secret@backend.example/private', request })
    expect((await invalid.search(searchRequest())).status).toBe(503)
    expect(request).not.toHaveBeenCalled()
  })
})

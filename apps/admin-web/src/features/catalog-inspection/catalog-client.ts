import { catalogPlaceSearchResponseSchema, type CatalogPlaceSearchResponse } from '@place/contracts/search'
import { publicPlaceDetailResponseSchema, type PublicPlaceDetailResponse } from '@place/contracts/places'

export type CatalogClient = Readonly<{
  search(query: string, cursor: string | undefined, signal: AbortSignal): Promise<CatalogPlaceSearchResponse>
  detail(placeId: string, signal: AbortSignal): Promise<PublicPlaceDetailResponse>
}>
export function createCatalogClient(request: typeof fetch = fetch): CatalogClient {
  async function read(path: string, init: RequestInit) {
    const response = await request(path, { ...init, cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? '관리자 권한을 다시 확인해 주세요.' : response.status === 404 || response.status === 410
        ? '장소가 없거나 더 이상 제공되지 않습니다.' : '조회에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    return response.json()
  }
  return {
    search: async (query, cursor, signal) => catalogPlaceSearchResponseSchema.parse(await read(
      '/api/admin/catalog', { method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 'catalog-place-search.v1', query, limit: 20,
          ...(cursor === undefined ? {} : { cursor }) }) })),
    detail: async (placeId, signal) => publicPlaceDetailResponseSchema.parse(await read(
      `/api/admin/catalog/${encodeURIComponent(placeId)}`, { signal })),
  }
}

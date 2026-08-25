import { randomUUID } from 'node:crypto'

import { getSearchTaxonomy } from '@/platform/search/search-backend-client'

export async function GET() {
  try {
    return Response.json(await getSearchTaxonomy(), {
      headers: { 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' },
    })
  } catch {
    return Response.json({
      type: 'urn:place:error:taxonomy-unavailable',
      title: '분류를 잠시 불러올 수 없습니다.',
      status: 503,
      code: 'PLACE_TAXONOMY_UNAVAILABLE',
      retryable: true,
      correlationRef: randomUUID(),
    }, { status: 503, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  }
}

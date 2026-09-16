import { catalogInteractionHttp } from '@/platform/search/catalog-interactions-http'

export const dynamic = 'force-dynamic'
export function POST(request: Request) { return catalogInteractionHttp('exploreV2', request) }

import { catalogInteractionHttp } from '@/platform/search/catalog-interactions-http'

export const runtime = 'nodejs'
export const POST = (request: Request) => catalogInteractionHttp('mapV3', request)

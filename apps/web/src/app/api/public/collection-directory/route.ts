import { browserPublicationHttp } from '@/platform/publications/browser-publication-http'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return browserPublicationHttp.directory(request)
}

import { browserSearchHttp } from '@/platform/search/browser-search-http'

export function GET() {
  return browserSearchHttp.taxonomy()
}

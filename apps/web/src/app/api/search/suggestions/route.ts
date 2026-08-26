import { browserSearchHttp } from '@/platform/search/browser-search-http'

export function POST(request: Request) {
  return browserSearchHttp.suggestions(request)
}

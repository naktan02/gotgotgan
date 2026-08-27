import { browserLibraryHttp } from '@/platform/library/browser-library-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return browserLibraryHttp.collections(request)
}

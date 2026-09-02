import { browserLibraryHttp } from '@/platform/library/browser-library-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserLibraryHttp.collectionCommand(request)
}

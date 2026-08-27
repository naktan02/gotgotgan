import { browserLibraryHttp } from '@/platform/library/browser-library-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ collectionId: string }>> }>,
): Promise<Response> {
  return browserLibraryHttp.collection(request, (await context.params).collectionId)
}

import { browserPublicationHttp } from '@/platform/publications/browser-publication-http'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ publicationId: string }> }>,
) {
  return browserPublicationHttp.discoverable((await context.params).publicationId, request)
}

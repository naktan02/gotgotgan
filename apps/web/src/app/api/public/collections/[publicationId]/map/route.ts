import { browserPublicationHttp } from '@/platform/publications/browser-publication-http'

export async function GET(
  request: Request,
  context: { params: Promise<{ publicationId: string }> },
): Promise<Response> {
  const { publicationId } = await context.params
  return browserPublicationHttp.collectionMap(publicationId, request)
}

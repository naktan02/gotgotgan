import { browserPublicationHttp } from '@/platform/publications/browser-publication-http'

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  const { publicationId } = await context.params
  return browserPublicationHttp.collection(publicationId)
}

import { browserPublicationHttp } from '@/platform/publications/browser-publication-http'

export async function GET(
  _request: Request,
  context: { params: Promise<{ placeId: string }> },
): Promise<Response> {
  return browserPublicationHttp.place((await context.params).placeId)
}

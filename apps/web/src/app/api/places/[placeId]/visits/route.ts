import { browserVisitHttp } from '@/platform/visits/browser-visit-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ placeId: string }>> }>,
): Promise<Response> {
  return browserVisitHttp.history(request, (await context.params).placeId)
}

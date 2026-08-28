import { browserVisitHttp } from '@/platform/visits/browser-visit-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserVisitHttp.record(request)
}

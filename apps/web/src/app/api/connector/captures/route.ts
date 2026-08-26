import { browserConnectorHttp } from '@/platform/imports/connector/browser-connector-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserConnectorHttp.submitCapture(request)
}

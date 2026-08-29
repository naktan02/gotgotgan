import { browserWritingHttp } from '@/platform/writing/browser-writing-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return browserWritingHttp.list(request)
}

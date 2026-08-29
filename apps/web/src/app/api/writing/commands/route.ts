import { browserWritingHttp } from '@/platform/writing/browser-writing-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserWritingHttp.command(request)
}

import { browserAuthHttp } from '@/platform/auth/browser-auth-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return browserAuthHttp.callback(request)
}

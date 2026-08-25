import { browserAuthHttp } from '@/platform/auth/browser-auth-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserAuthHttp.logout(request)
}

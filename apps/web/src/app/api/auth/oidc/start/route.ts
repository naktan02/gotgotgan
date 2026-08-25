import { browserAuthHttp } from '@/platform/auth/browser-auth-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  return browserAuthHttp.start()
}

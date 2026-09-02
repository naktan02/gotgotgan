import { adminSessionHttp } from '@/platform/membership/admin-session-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return adminSessionHttp.current(request)
}

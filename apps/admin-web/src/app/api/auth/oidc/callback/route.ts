import { adminBrowserAuthHttp } from '@/platform/auth/admin-oidc-lifecycle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return adminBrowserAuthHttp.callback(request)
}

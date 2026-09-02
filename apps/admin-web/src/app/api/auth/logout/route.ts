import { adminBrowserAuthHttp } from '@/platform/auth/admin-oidc-lifecycle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return adminBrowserAuthHttp.logout(request)
}

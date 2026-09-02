import { adminBrowserAuthHttp } from '@/platform/auth/admin-oidc-lifecycle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  return adminBrowserAuthHttp.start()
}

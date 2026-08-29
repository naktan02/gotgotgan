import { browserProfileHttp } from '@/platform/profiles/browser-profile-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return browserProfileHttp.notices(request)
}

import { browserProfileHttp } from '@/platform/profiles/browser-profile-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: Request): Promise<Response> {
  return browserProfileHttp.appeal(request)
}

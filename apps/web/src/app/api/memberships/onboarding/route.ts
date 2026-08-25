import { browserMembershipHttp } from '@/platform/membership/browser-membership-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserMembershipHttp.onboard(request)
}

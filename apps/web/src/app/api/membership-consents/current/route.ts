import { browserMembershipHttp } from '@/platform/membership/browser-membership-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  return browserMembershipHttp.currentConsents()
}

import { adminProcessReadiness } from '@/platform/process-readiness/admin-process-readiness'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  return adminProcessReadiness.check()
}

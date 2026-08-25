import { browserProcessReadiness } from '@/platform/process-readiness/browser-process-readiness'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  return browserProcessReadiness.check()
}

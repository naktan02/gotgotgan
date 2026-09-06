import { serveOpenFreeMapSource } from '@/platform/maps/openfreemap-source/openfreemap-source-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  return serveOpenFreeMapSource(request)
}

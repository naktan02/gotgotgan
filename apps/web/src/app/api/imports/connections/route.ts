import { browserImportHttp } from '@/platform/imports/browser-import-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  return browserImportHttp.connections(request)
}

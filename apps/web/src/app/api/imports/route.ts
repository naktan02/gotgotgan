import { browserImportHttp } from '@/platform/imports/browser-import-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return browserImportHttp.start(request)
}

import { browserImportHttp } from '@/platform/imports/browser-import-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ batchId: string }>> }>,
): Promise<Response> {
  return browserImportHttp.resume(request, (await context.params).batchId)
}

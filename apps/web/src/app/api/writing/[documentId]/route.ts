import { browserWritingHttp } from '@/platform/writing/browser-writing-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ documentId: string }>> }>,
): Promise<Response> {
  return browserWritingHttp.detail(request, (await context.params).documentId)
}

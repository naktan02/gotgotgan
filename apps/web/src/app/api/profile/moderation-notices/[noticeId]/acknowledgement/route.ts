import { browserProfileHttp } from '@/platform/profiles/browser-profile-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PUT(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ noticeId: string }>> }>,
): Promise<Response> {
  return browserProfileHttp.acknowledgeNotice((await context.params).noticeId, request)
}

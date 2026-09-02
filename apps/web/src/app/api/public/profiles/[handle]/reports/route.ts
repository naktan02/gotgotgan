import { browserProfileHttp } from '@/platform/profiles/browser-profile-http'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ handle: string }> }>,
) {
  return browserProfileHttp.report((await context.params).handle, request)
}

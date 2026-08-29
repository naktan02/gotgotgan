import { browserProfileHttp } from '@/platform/profiles/browser-profile-http'

export async function GET(
  request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return browserProfileHttp.published((await context.params).handle, request)
}

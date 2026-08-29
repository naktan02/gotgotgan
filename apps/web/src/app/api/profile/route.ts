import { browserProfileHttp } from '@/platform/profiles/browser-profile-http'

export function GET(request: Request): Promise<Response> {
  return browserProfileHttp.current(request)
}

export function PUT(request: Request): Promise<Response> {
  return browserProfileHttp.set(request)
}

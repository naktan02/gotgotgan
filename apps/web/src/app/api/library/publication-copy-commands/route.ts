import { browserLibraryHttp } from '@/platform/library/browser-library-http'

export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return browserLibraryHttp.publicationCopyCommand(request)
}

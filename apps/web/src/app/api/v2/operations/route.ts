import { browserOperationHttp } from '@/platform/imports/operations/browser-operation-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) { return browserOperationHttp.list(request) }

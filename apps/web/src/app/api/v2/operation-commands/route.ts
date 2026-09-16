import { browserOperationHttp } from '@/platform/imports/operations/browser-operation-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) { return browserOperationHttp.command(request) }

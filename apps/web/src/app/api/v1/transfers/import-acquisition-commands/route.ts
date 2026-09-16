import { browserTransferHttp } from '@/platform/imports/transfers/browser-transfer-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return browserTransferHttp.importAcquisitionCommand(request)
}

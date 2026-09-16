import { browserTransferHttp } from '@/platform/imports/transfers/browser-transfer-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ acquisitionId: string }> }>,
) {
  return browserTransferHttp.importAcquisition(
    request,
    (await context.params).acquisitionId,
  )
}

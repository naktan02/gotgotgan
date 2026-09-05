import { browserTransferHttp } from '@/platform/imports/transfers/browser-transfer-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ snapshotId: string }> }>,
) {
  return browserTransferHttp.snapshotV3(request, (await context.params).snapshotId)
}

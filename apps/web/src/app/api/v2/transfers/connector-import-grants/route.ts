import { browserConnectorTransferHttp } from '@/platform/imports/connector/transfers/browser-connector-transfer-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: Request): Promise<Response> {
  return browserConnectorTransferHttp.issueImportGrant(request)
}

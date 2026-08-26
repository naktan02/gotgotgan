import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { MemberConnectorObservationReport } from '../../application/observe-provider-network.js'

const reportIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class PrivateObservationReportStore {
  constructor(private readonly root: string) {}

  async write(input: Readonly<{
    reportId: string
    report: MemberConnectorObservationReport
  }>): Promise<Readonly<{ reportId: string }>> {
    try {
      if (!reportIdPattern.test(input.reportId)) throw new Error('Invalid report identity')
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      await writeFile(
        join(this.root, `${input.reportId}.json`),
        `${JSON.stringify(input.report, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
      return { reportId: input.reportId }
    } catch {
      throw new Error('Observation report could not be written')
    }
  }
}

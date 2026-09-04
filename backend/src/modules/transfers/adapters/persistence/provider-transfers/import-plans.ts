import type {
  ImportPlanCommandRequestV2,
  ImportPlanV2,
  TransferCommandResult,
} from '../../../domain/model.js'
import { ImportPlanApproval } from './import-plan-approval.js'
import { ImportPlanDrafts } from './import-plan-drafts.js'
import { ImportPlanProjection } from './import-plan-projection.js'
import { ProviderTransferContext } from './provider-transfer-context.js'
import { ProviderSourceSnapshots } from './source-snapshots.js'

export class ProviderImportPlans {
  private readonly projection: ImportPlanProjection
  private readonly drafts: ImportPlanDrafts
  private readonly approval: ImportPlanApproval

  constructor(context: ProviderTransferContext, snapshots: ProviderSourceSnapshots) {
    this.projection = new ImportPlanProjection(context)
    this.drafts = new ImportPlanDrafts(context, snapshots, this.projection)
    this.approval = new ImportPlanApproval(context, this.projection)
  }

  apply(
    memberId: string,
    command: ImportPlanCommandRequestV2,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    if (command.kind === 'create') return this.drafts.create(memberId, command)
    if (command.kind === 'decide-item') return this.drafts.decide(memberId, command)
    return this.approval.approve(memberId, command)
  }

  get(memberId: string, planId: string): Promise<ImportPlanV2 | undefined> {
    return this.projection.get(memberId, planId)
  }
}

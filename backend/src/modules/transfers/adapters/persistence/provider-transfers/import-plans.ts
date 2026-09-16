import type {
  ImportPlanCommandRequestV2,
  ImportPlanCommandRequestV3,
  ImportPlanCommandRequestV4,
  ImportPlanV2,
  ImportPlanV3,
  ImportPlanV4,
  TransferCommandResult,
} from '../../../domain/model.js'
import { ImportPlanApproval } from './import-plan-approval.js'
import { ImportPlanDrafts } from './import-plan-drafts.js'
import { ImportPlanEvidenceRefresh } from './import-plan-evidence-refresh.js'
import { ImportPlanProjection } from './import-plan-projection.js'
import { ProviderTransferContext } from './provider-transfer-context.js'
import { ProviderSourceSnapshots } from './source-snapshots.js'
import { SourceSnapshotProjection } from './source-snapshot-projection.js'

export class ProviderImportPlans {
  private readonly projection: ImportPlanProjection
  private readonly drafts: ImportPlanDrafts
  private readonly evidenceRefresh: ImportPlanEvidenceRefresh
  private readonly approval: ImportPlanApproval

  constructor(
    context: ProviderTransferContext,
    snapshots: ProviderSourceSnapshots,
    sourceSnapshots: SourceSnapshotProjection,
  ) {
    this.projection = new ImportPlanProjection(context)
    this.drafts = new ImportPlanDrafts(context, snapshots, sourceSnapshots, this.projection)
    this.evidenceRefresh = new ImportPlanEvidenceRefresh(context, this.projection)
    this.approval = new ImportPlanApproval(context, this.projection)
  }

  applyV2(
    memberId: string,
    command: ImportPlanCommandRequestV2,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    if (command.kind === 'create') return this.drafts.createV2(memberId, command)
    if (command.kind === 'decide-item') return this.drafts.decideV2(memberId, command)
    return this.approval.approveV2(memberId, command)
  }

  getV2(memberId: string, planId: string): Promise<ImportPlanV2 | undefined> {
    return this.projection.getV2(memberId, planId)
  }

  applyV3(
    memberId: string,
    command: ImportPlanCommandRequestV3,
  ): Promise<TransferCommandResult<ImportPlanV3>> {
    if (command.kind === 'create') return this.drafts.createV3(memberId, command)
    if (command.kind === 'decide-item') return this.drafts.decideV3(memberId, command)
    if (command.kind === 'refresh-evidence') {
      return this.evidenceRefresh.refreshV3(memberId, command)
    }
    return this.approval.approveV3(memberId, command)
  }

  getV3(memberId: string, planId: string): Promise<ImportPlanV3 | undefined> {
    return this.projection.getV3(memberId, planId)
  }

  applyV4(
    memberId: string,
    command: ImportPlanCommandRequestV4,
  ): Promise<TransferCommandResult<ImportPlanV4>> {
    if (command.kind === 'create') return this.drafts.createV4(memberId, command)
    if (command.kind === 'decide-item') return this.drafts.decideV4(memberId, command)
    if (command.kind === 'refresh-evidence') {
      return this.evidenceRefresh.refreshV4(memberId, command)
    }
    return this.approval.approveV4(memberId, command)
  }

  getV4(memberId: string, planId: string): Promise<ImportPlanV4 | undefined> {
    return this.projection.getV4(memberId, planId)
  }
}

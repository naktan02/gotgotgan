import type {
  ImportSourceTransfers,
  ProviderTransfers,
  TrustedImportSourceObservations,
  TrustedProviderTransferObservations,
} from '../../domain/model.js'
import { ProviderConnections } from './provider-transfers/connections.js'
import { ProviderImportPlans } from './provider-transfers/import-plans.js'
import { ProviderOutboundPlans } from './provider-transfers/outbound-plans.js'
import {
  ProviderTransferContext,
  type ProviderTransferOptions,
} from './provider-transfers/provider-transfer-context.js'
import { ProviderSourceSnapshots } from './provider-transfers/source-snapshots.js'
import { OneShotSourceSnapshots } from './provider-transfers/one-shot-source-snapshots.js'
import { SourceSnapshotProjection } from './provider-transfers/source-snapshot-projection.js'

/**
 * Stable provider-transfer adapter seam. Connection truth, immutable snapshots,
 * import planning, and outbound planning are private peer modules.
 */
export class PostgresProviderTransfers
implements ProviderTransfers, ImportSourceTransfers,
  TrustedProviderTransferObservations, TrustedImportSourceObservations {
  private readonly connections: ProviderConnections
  private readonly snapshots: ProviderSourceSnapshots
  private readonly oneShotSnapshots: OneShotSourceSnapshots
  private readonly sourceSnapshotProjection: SourceSnapshotProjection
  private readonly imports: ProviderImportPlans
  private readonly outbound: ProviderOutboundPlans

  constructor(options: ProviderTransferOptions) {
    const context = new ProviderTransferContext(options)
    this.connections = new ProviderConnections(context)
    this.snapshots = new ProviderSourceSnapshots(context)
    this.oneShotSnapshots = new OneShotSourceSnapshots(context)
    this.sourceSnapshotProjection = new SourceSnapshotProjection(context)
    this.imports = new ProviderImportPlans(context, this.snapshots, this.sourceSnapshotProjection)
    this.outbound = new ProviderOutboundPlans(context)
  }

  listCapabilities(
    ...input: Parameters<ProviderTransfers['listCapabilities']>
  ): ReturnType<ProviderTransfers['listCapabilities']> {
    return this.connections.listCapabilities(...input)
  }

  listConnections(
    ...input: Parameters<ProviderTransfers['listConnections']>
  ): ReturnType<ProviderTransfers['listConnections']> {
    return this.connections.list(...input)
  }

  applyConnectionCommand(
    ...input: Parameters<ProviderTransfers['applyConnectionCommand']>
  ): ReturnType<ProviderTransfers['applyConnectionCommand']> {
    return this.connections.applyCommand(...input)
  }

  recordConnectionObservation(
    ...input: Parameters<TrustedProviderTransferObservations['recordConnectionObservation']>
  ): ReturnType<TrustedProviderTransferObservations['recordConnectionObservation']> {
    return this.connections.recordObservation(...input)
  }

  recordSourceSnapshot(
    ...input: Parameters<TrustedProviderTransferObservations['recordSourceSnapshot']>
  ): ReturnType<TrustedProviderTransferObservations['recordSourceSnapshot']> {
    return this.snapshots.record(...input)
  }

  recordSourceSnapshotV3(
    ...input: Parameters<TrustedImportSourceObservations['recordSourceSnapshotV3']>
  ): ReturnType<TrustedImportSourceObservations['recordSourceSnapshotV3']> {
    return this.oneShotSnapshots.record(...input)
  }

  listSnapshots(
    ...input: Parameters<ProviderTransfers['listSnapshots']>
  ): ReturnType<ProviderTransfers['listSnapshots']> {
    return this.snapshots.list(...input)
  }

  getSnapshot(
    ...input: Parameters<ProviderTransfers['getSnapshot']>
  ): ReturnType<ProviderTransfers['getSnapshot']> {
    return this.snapshots.get(...input)
  }

  listSnapshotsV3(
    ...input: Parameters<ImportSourceTransfers['listSnapshotsV3']>
  ): ReturnType<ImportSourceTransfers['listSnapshotsV3']> {
    return this.sourceSnapshotProjection.listV3(...input)
  }

  getSnapshotV3(
    ...input: Parameters<ImportSourceTransfers['getSnapshotV3']>
  ): ReturnType<ImportSourceTransfers['getSnapshotV3']> {
    return this.sourceSnapshotProjection.getV3(...input)
  }

  applyImportPlanCommandV2(
    ...input: Parameters<ProviderTransfers['applyImportPlanCommandV2']>
  ): ReturnType<ProviderTransfers['applyImportPlanCommandV2']> {
    return this.imports.applyV2(...input)
  }

  getImportPlanV2(
    ...input: Parameters<ProviderTransfers['getImportPlanV2']>
  ): ReturnType<ProviderTransfers['getImportPlanV2']> {
    return this.imports.getV2(...input)
  }

  applyImportPlanCommandV3(
    ...input: Parameters<ProviderTransfers['applyImportPlanCommandV3']>
  ): ReturnType<ProviderTransfers['applyImportPlanCommandV3']> {
    return this.imports.applyV3(...input)
  }

  getImportPlanV3(
    ...input: Parameters<ProviderTransfers['getImportPlanV3']>
  ): ReturnType<ProviderTransfers['getImportPlanV3']> {
    return this.imports.getV3(...input)
  }

  applyImportPlanCommandV4(
    ...input: Parameters<ImportSourceTransfers['applyImportPlanCommandV4']>
  ): ReturnType<ImportSourceTransfers['applyImportPlanCommandV4']> {
    return this.imports.applyV4(...input)
  }

  getImportPlanV4(
    ...input: Parameters<ImportSourceTransfers['getImportPlanV4']>
  ): ReturnType<ImportSourceTransfers['getImportPlanV4']> {
    return this.imports.getV4(...input)
  }

  listTargetLists(
    ...input: Parameters<ProviderTransfers['listTargetLists']>
  ): ReturnType<ProviderTransfers['listTargetLists']> {
    return this.outbound.listTargetLists(...input)
  }

  applyOutboundTransferCommand(
    ...input: Parameters<ProviderTransfers['applyOutboundTransferCommand']>
  ): ReturnType<ProviderTransfers['applyOutboundTransferCommand']> {
    return this.outbound.apply(...input)
  }

  getOutboundTransfer(
    ...input: Parameters<ProviderTransfers['getOutboundTransfer']>
  ): ReturnType<ProviderTransfers['getOutboundTransfer']> {
    return this.outbound.get(...input)
  }
}

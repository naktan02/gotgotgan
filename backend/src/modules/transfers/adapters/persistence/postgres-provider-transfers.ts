import type {
  ProviderTransfers,
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

/**
 * Stable provider-transfer adapter seam. Connection truth, immutable snapshots,
 * import planning, and outbound planning are private peer modules.
 */
export class PostgresProviderTransfers
implements ProviderTransfers, TrustedProviderTransferObservations {
  private readonly connections: ProviderConnections
  private readonly snapshots: ProviderSourceSnapshots
  private readonly imports: ProviderImportPlans
  private readonly outbound: ProviderOutboundPlans

  constructor(options: ProviderTransferOptions) {
    const context = new ProviderTransferContext(options)
    this.connections = new ProviderConnections(context)
    this.snapshots = new ProviderSourceSnapshots(context)
    this.imports = new ProviderImportPlans(context, this.snapshots)
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

  applyImportPlanCommand(
    ...input: Parameters<ProviderTransfers['applyImportPlanCommand']>
  ): ReturnType<ProviderTransfers['applyImportPlanCommand']> {
    return this.imports.apply(...input)
  }

  getImportPlan(
    ...input: Parameters<ProviderTransfers['getImportPlan']>
  ): ReturnType<ProviderTransfers['getImportPlan']> {
    return this.imports.get(...input)
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

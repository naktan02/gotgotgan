import {
  composeOutboundExportRuntime,
  type OutboundExportRuntime,
  type OutboundExportRuntimeDependencies,
} from './outbound-export/index.js'
import {
  collectAndHandoffImmutableSnapshot,
  type ImmutableSnapshotHandoffResult,
  type ImmutableSnapshotProgress,
  type ImmutableSnapshotRuntimeDependencies,
} from './import-snapshot/index.js'
import type {
  ConnectorSnapshotGrantAttempt,
  ConnectorSnapshotIdentity,
} from './import-snapshot/index.js'

type ProviderKey = 'naver' | 'kakao' | 'google'

export type ConnectorTransferRuntimeCapabilities = Readonly<{
  importProviders: readonly ProviderKey[]
  exportProviders: readonly ProviderKey[]
}>

export type ConnectorTransferImportRuntime = Readonly<{
  providerKey: ProviderKey
  collect(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    grantAttempt: ConnectorSnapshotGrantAttempt
    signal: AbortSignal
    onProgress?: (progress: ImmutableSnapshotProgress) => void | Promise<void>
  }>): Promise<ImmutableSnapshotHandoffResult>
}>

export type ConnectorTransferExportRuntime = OutboundExportRuntime

export type ConnectorTransferRuntime = Readonly<{
  capabilities: ConnectorTransferRuntimeCapabilities
  imports: ReadonlyMap<ProviderKey, ConnectorTransferImportRuntime>
  exports: ReadonlyMap<ProviderKey, ConnectorTransferExportRuntime>
}>

export type ConnectorTransferRuntimeDependencies = Readonly<{
  imports?: ReadonlyMap<ProviderKey, ImmutableSnapshotRuntimeDependencies>
  exports?: ReadonlyMap<ProviderKey, OutboundExportRuntimeDependencies>
}>

function sortedProviders(values: Iterable<ProviderKey>): readonly ProviderKey[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function assertImportBinding(
  providerKey: ProviderKey,
  dependencies: ImmutableSnapshotRuntimeDependencies,
): void {
  if (
    dependencies.session.providerKey !== providerKey ||
    dependencies.accountFingerprint.providerKey !== providerKey ||
    dependencies.source.providerKey !== providerKey ||
    dependencies.normalizer.providerKey !== providerKey ||
    typeof dependencies.session.probe !== 'function' ||
    typeof dependencies.accountFingerprint.read !== 'function' ||
    typeof dependencies.source.collect !== 'function' ||
    typeof dependencies.normalizer.normalize !== 'function' ||
    typeof dependencies.spool.open !== 'function' ||
    typeof dependencies.spool.stage !== 'function' ||
    typeof dependencies.spool.seal !== 'function' ||
    typeof dependencies.spool.read !== 'function' ||
    typeof dependencies.handoff.issueGrant !== 'function' ||
    typeof dependencies.handoff.status !== 'function' ||
    typeof dependencies.handoff.upload !== 'function' ||
    typeof dependencies.handoff.complete !== 'function'
  ) throw new Error(`Connector import runtime binding differs for ${providerKey}`)
}

function composeImportRuntime(
  providerKey: ProviderKey,
  dependencies: ImmutableSnapshotRuntimeDependencies,
): ConnectorTransferImportRuntime {
  assertImportBinding(providerKey, dependencies)
  return Object.freeze({
    providerKey,
    collect: (input) => collectAndHandoffImmutableSnapshot(dependencies, input),
  })
}

/**
 * Composes only complete v2 transfer capabilities. Missing dependencies stay unavailable; there is
 * deliberately no fallback to the retired v1 upload route or to an unverified Provider writer.
 */
export function composeConnectorTransferRuntime(
  dependencies: ConnectorTransferRuntimeDependencies = {},
): ConnectorTransferRuntime {
  const imports = new Map<ProviderKey, ConnectorTransferImportRuntime>()
  for (const [providerKey, provider] of dependencies.imports ?? []) {
    imports.set(providerKey, composeImportRuntime(providerKey, provider))
  }
  const exports = new Map<ProviderKey, ConnectorTransferExportRuntime>()
  for (const [providerKey, provider] of dependencies.exports ?? []) {
    exports.set(providerKey, composeOutboundExportRuntime(providerKey, provider))
  }
  return Object.freeze({
    capabilities: Object.freeze({
      importProviders: Object.freeze(sortedProviders(imports.keys())),
      exportProviders: Object.freeze(sortedProviders(exports.keys())),
    }),
    imports,
    exports,
  })
}

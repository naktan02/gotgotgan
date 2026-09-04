import type { ConnectorCaptureManifestV2 } from '@place/contracts/transfers'

import type { ProviderSession } from '../ports/provider-session.js'
import type { SavedPlaceSource } from '../ports/saved-place-source.js'
import type { ProviderAccountFingerprint } from './ports/account-fingerprint.js'
import type {
  ConnectorSnapshotGrantAttempt,
  ConnectorSnapshotHandoff,
  ConnectorSnapshotIdentity,
  ConnectorSnapshotSpool,
} from './ports/snapshot-handoff.js'
import type { SavedPlaceSnapshotNormalizer } from './ports/snapshot-normalizer.js'

export type ImmutableSnapshotProgress = Readonly<{
  phase: 'checking-session' | 'collecting' | 'authorizing' | 'uploading' | 'completing'
  capturedChunks: number
  capturedItems: number
  uploadedChunks: number
  uploadedItems: number
}>

export type ImmutableSnapshotHandoffResult =
  | Readonly<{
      status: 'completed' | 'replayed'
      manifest: ConnectorCaptureManifestV2
      snapshotId: string
      snapshotVersion: string
    }>
  | Readonly<{
      status: 'incomplete'
      manifest: ConnectorCaptureManifestV2
      missingSequences: readonly number[]
    }>

export type ImmutableSnapshotLimits = Readonly<{
  maximumChunks: number
  maximumItems: number
  maximumBytes: number
  maximumChunkBytes: number
}>

export class ImmutableSnapshotError extends Error {
  constructor(
    readonly code:
      | 'binding-mismatch'
      | 'capture-conflict'
      | 'capture-invalid'
      | 'grant-rejected'
      | 'grant-invalid'
      | 'grant-expired'
      | 'handoff-invalid'
      | 'provider-unavailable'
      | 'reauth-required',
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'ImmutableSnapshotError'
  }
}

export type ImmutableSnapshotRuntimeDependencies = Readonly<{
  session: ProviderSession
  accountFingerprint: ProviderAccountFingerprint
  source: SavedPlaceSource
  normalizer: SavedPlaceSnapshotNormalizer
  spool: ConnectorSnapshotSpool
  handoff: ConnectorSnapshotHandoff
  limits: ImmutableSnapshotLimits
  now?: () => Date
}>

export type ImmutableSnapshotInput = Readonly<{
  identity: ConnectorSnapshotIdentity
  grantAttempt: ConnectorSnapshotGrantAttempt
  signal: AbortSignal
  onProgress?: (progress: ImmutableSnapshotProgress) => void | Promise<void>
}>

export function assertSnapshotDependencies(
  dependencies: ImmutableSnapshotRuntimeDependencies,
  identity: ConnectorSnapshotIdentity,
): void {
  if (
    dependencies.session.providerKey !== identity.providerKey ||
    dependencies.accountFingerprint.providerKey !== identity.providerKey ||
    dependencies.source.providerKey !== identity.providerKey ||
    dependencies.normalizer.providerKey !== identity.providerKey
  ) throw new ImmutableSnapshotError('binding-mismatch', false, 'Snapshot Provider binding differs')
  if (dependencies.normalizer.parserVersion.trim().length === 0) {
    throw new ImmutableSnapshotError('capture-invalid', false, 'Snapshot parser version is invalid')
  }
  if (!/^[a-f0-9]{64}$/.test(identity.accountFingerprint)) {
    throw new ImmutableSnapshotError('binding-mismatch', false, 'Snapshot account fingerprint is invalid')
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if ([
    identity.operationId, identity.connectionId, identity.installationId, identity.manifestId,
  ].some((value) => !uuid.test(value))) {
    throw new ImmutableSnapshotError('binding-mismatch', false, 'Snapshot identity is invalid')
  }
  if (Object.values(dependencies.limits).some((value) => !Number.isInteger(value) || value < 1) ||
    dependencies.limits.maximumChunkBytes > dependencies.limits.maximumBytes) {
    throw new ImmutableSnapshotError('capture-invalid', false, 'Snapshot limits are invalid')
  }
}

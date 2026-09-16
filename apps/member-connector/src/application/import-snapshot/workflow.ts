import {
  connectorCaptureManifestV2Schema,
  connectorImportGrantRequestV2Schema,
  connectorImportGrantResultV2Schema,
} from '@place/contracts/transfers'

import { collectImmutableSnapshot } from './collection.js'
import { requireNotAborted } from './commitment.js'
import { handoffImmutableSnapshot, requireBoundGrant } from './handoff.js'
import {
  ImmutableSnapshotError,
  assertSnapshotDependencies,
  type ImmutableSnapshotHandoffResult,
  type ImmutableSnapshotInput,
  type ImmutableSnapshotRuntimeDependencies,
} from './model.js'

/**
 * Collects once into a durable immutable spool, obtains an exact manifest-bound grant, resumes a
 * contiguous server prefix, and finalizes explicitly. Phase details stay in sibling modules.
 */
export async function collectAndHandoffImmutableSnapshot(
  dependencies: ImmutableSnapshotRuntimeDependencies,
  input: ImmutableSnapshotInput,
): Promise<ImmutableSnapshotHandoffResult> {
  assertSnapshotDependencies(dependencies, input.identity)
  requireNotAborted(input.signal)
  const now = dependencies.now ?? (() => new Date())
  const openedAt = now().toISOString()
  const spool = await dependencies.spool.open({
    identity: input.identity, observedAt: openedAt, capturedAt: openedAt, signal: input.signal,
  })
  const manifest = spool.state === 'sealed'
    ? connectorCaptureManifestV2Schema.parse(spool.manifest)
    : await collectImmutableSnapshot(dependencies, input, spool.observedAt, spool.capturedAt)

  await input.onProgress?.({
    phase: 'authorizing', capturedChunks: manifest.chunkCount,
    capturedItems: manifest.itemCount, uploadedChunks: 0, uploadedItems: 0,
  })
  const request = connectorImportGrantRequestV2Schema.parse({
    schemaVersion: 'connector-import-grant-request.v2',
    commandId: input.grantAttempt.commandId,
    operationId: input.identity.operationId,
    connectionId: input.identity.connectionId,
    expectedConnectionRevision: input.grantAttempt.expectedConnectionRevision,
    providerKey: input.identity.providerKey,
    accountFingerprint: input.identity.accountFingerprint,
    installationId: input.identity.installationId,
    placeOrigin: input.grantAttempt.placeOrigin,
    manifest,
  })
  const grantResult = connectorImportGrantResultV2Schema.parse(
    await dependencies.handoff.issueGrant({ request, signal: input.signal }),
  )
  if (grantResult.commandId !== input.grantAttempt.commandId) {
    throw new ImmutableSnapshotError('grant-invalid', false, 'Connector grant command differs')
  }
  if (grantResult.outcome === 'rejected') {
    throw new ImmutableSnapshotError('grant-rejected', false, 'Connector grant rejected')
  }
  const grant = requireBoundGrant(
    grantResult.grant, input.identity, input.grantAttempt, manifest, now(),
  )
  return handoffImmutableSnapshot(dependencies, input, grant, manifest, now)
}

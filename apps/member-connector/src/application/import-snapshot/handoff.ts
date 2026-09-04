import {
  connectorCaptureChunkReceiptV2Schema,
  connectorCaptureChunkV2Schema,
  connectorCaptureCompleteResultV2Schema,
  connectorCaptureManifestDigestInputV2,
  connectorCaptureManifestStatusV2Schema,
  connectorImportGrantV2Schema,
  type ConnectorCaptureManifestV2,
  type ConnectorImportGrantV2,
} from '@place/contracts/transfers'

import type {
  ConnectorSnapshotChunkDescriptor,
  ConnectorSnapshotGrantAttempt,
  ConnectorSnapshotIdentity,
} from './ports/snapshot-handoff.js'
import { requireNotAborted, sha256, utf8Bytes } from './commitment.js'
import {
  ImmutableSnapshotError,
  type ImmutableSnapshotHandoffResult,
  type ImmutableSnapshotInput,
  type ImmutableSnapshotRuntimeDependencies,
} from './model.js'

export function assertGrantActive(grant: ConnectorImportGrantV2, now: Date): void {
  const instant = now.getTime()
  if (!Number.isFinite(instant) || Date.parse(grant.issuedAt) > instant ||
    Date.parse(grant.expiresAt) <= instant) {
    throw new ImmutableSnapshotError('grant-expired', true, 'Connector import grant is not active')
  }
}

export function requireBoundGrant(
  candidate: unknown,
  identity: ConnectorSnapshotIdentity,
  grantAttempt: ConnectorSnapshotGrantAttempt,
  manifest: ConnectorCaptureManifestV2,
  now: Date,
): ConnectorImportGrantV2 {
  const parsed = connectorImportGrantV2Schema.safeParse(candidate)
  if (!parsed.success) {
    throw new ImmutableSnapshotError('grant-invalid', false, 'Connector import grant is invalid')
  }
  const grant = parsed.data
  if (
    grant.operationId !== identity.operationId || grant.connectionId !== identity.connectionId ||
    grant.providerKey !== identity.providerKey ||
    grant.accountFingerprint !== identity.accountFingerprint ||
    grant.installationId !== identity.installationId ||
    grant.placeOrigin !== grantAttempt.placeOrigin ||
    JSON.stringify(grant.manifest) !== JSON.stringify(manifest)
  ) throw new ImmutableSnapshotError('binding-mismatch', false, 'Connector import grant binding differs')
  assertGrantActive(grant, now)
  return grant
}

function assertStatus(
  status: ReturnType<typeof connectorCaptureManifestStatusV2Schema.parse>,
  identity: ConnectorSnapshotIdentity,
  manifest: ConnectorCaptureManifestV2,
): void {
  if (status.operationId !== identity.operationId || status.manifestId !== manifest.manifestId) {
    throw new ImmutableSnapshotError('handoff-invalid', false, 'Snapshot status binding differs')
  }
  const expected = Array.from({ length: status.nextSequence }, (_, sequence) => sequence)
  if (status.nextSequence > manifest.chunkCount ||
    JSON.stringify(status.recordedSequences) !== JSON.stringify(expected)) {
    throw new ImmutableSnapshotError('handoff-invalid', false, 'Snapshot resume status is not contiguous')
  }
  if (status.state === 'completed' && status.nextSequence !== manifest.chunkCount) {
    throw new ImmutableSnapshotError('handoff-invalid', false, 'Completed snapshot is missing chunks')
  }
  if (status.state === 'receiving' && (status.snapshotId !== null || status.snapshotVersion !== null)) {
    throw new ImmutableSnapshotError('handoff-invalid', false, 'Receiving snapshot has a published identity')
  }
}

/** Uploads only a sealed snapshot and accepts only an exact contiguous server prefix. */
export async function handoffImmutableSnapshot(
  dependencies: ImmutableSnapshotRuntimeDependencies,
  input: ImmutableSnapshotInput,
  grant: ConnectorImportGrantV2,
  manifest: ConnectorCaptureManifestV2,
  now: () => Date,
): Promise<ImmutableSnapshotHandoffResult> {
  assertGrantActive(grant, now())
  const status = connectorCaptureManifestStatusV2Schema.parse(
    await dependencies.handoff.status({ grant, signal: input.signal }),
  )
  assertStatus(status, input.identity, manifest)
  if (status.state === 'completed') {
    if (status.snapshotId === null || status.snapshotVersion === null) {
      throw new ImmutableSnapshotError('handoff-invalid', false, 'Completed snapshot has no identity')
    }
    return { status: 'replayed', manifest,
      snapshotId: status.snapshotId, snapshotVersion: status.snapshotVersion }
  }
  if (status.state !== 'receiving') {
    throw new ImmutableSnapshotError('grant-expired', false, 'Snapshot handoff is no longer active')
  }

  const descriptors: ConnectorSnapshotChunkDescriptor[] = []
  let totalItems = 0
  let totalBytes = 0
  let sequence = 0
  for await (const rawChunk of dependencies.spool.read({
    identity: input.identity, fromSequence: 0, signal: input.signal,
  })) {
    requireNotAborted(input.signal)
    const chunk = connectorCaptureChunkV2Schema.parse(rawChunk)
    if (
      chunk.operationId !== input.identity.operationId || chunk.manifestId !== manifest.manifestId ||
      chunk.sequence !== sequence || utf8Bytes(chunk.payload) !== chunk.byteCount ||
      await sha256(chunk.payload) !== chunk.checksum ||
      chunk.byteCount > grant.limits.maximumChunkBytes
    ) throw new ImmutableSnapshotError('capture-conflict', false, 'Staged snapshot chunk differs')
    descriptors.push({ sequence: chunk.sequence, itemCount: chunk.itemCount,
      byteCount: chunk.byteCount, checksum: chunk.checksum })
    totalItems += chunk.itemCount
    totalBytes += chunk.byteCount
    sequence += 1
    if (chunk.sequence < status.nextSequence) continue

    assertGrantActive(grant, now())
    const receipt = connectorCaptureChunkReceiptV2Schema.parse(
      await dependencies.handoff.upload({ grant, chunk, signal: input.signal }),
    )
    if (
      receipt.operationId !== input.identity.operationId ||
      receipt.manifestId !== manifest.manifestId || receipt.acceptedSequence !== chunk.sequence ||
      receipt.nextSequence !== chunk.sequence + 1 || receipt.receivedChunks !== chunk.sequence + 1 ||
      receipt.receivedItems !== totalItems || receipt.receivedBytes !== totalBytes
    ) throw new ImmutableSnapshotError('handoff-invalid', false, 'Snapshot chunk receipt differs')
    await input.onProgress?.({
      phase: 'uploading', capturedChunks: manifest.chunkCount,
      capturedItems: manifest.itemCount, uploadedChunks: receipt.receivedChunks,
      uploadedItems: receipt.receivedItems,
    })
  }
  const recomputedDigest = await sha256(connectorCaptureManifestDigestInputV2({
    operationId: input.identity.operationId, connectionId: input.identity.connectionId,
    providerKey: input.identity.providerKey, accountFingerprint: input.identity.accountFingerprint,
    installationId: input.identity.installationId,
    manifest: { manifestId: manifest.manifestId, sourceRevision: manifest.sourceRevision,
      observedAt: manifest.observedAt, capturedAt: manifest.capturedAt,
      chunkCount: manifest.chunkCount, listCount: manifest.listCount,
      itemCount: manifest.itemCount, byteCount: manifest.byteCount },
    chunks: descriptors,
  }))
  if (sequence !== manifest.chunkCount || totalItems !== manifest.itemCount ||
    totalBytes !== manifest.byteCount || recomputedDigest !== manifest.manifestDigest) {
    throw new ImmutableSnapshotError('capture-conflict', false, 'Sealed snapshot commitment differs')
  }

  await input.onProgress?.({
    phase: 'completing', capturedChunks: manifest.chunkCount,
    capturedItems: manifest.itemCount, uploadedChunks: manifest.chunkCount,
    uploadedItems: manifest.itemCount,
  })
  assertGrantActive(grant, now())
  const completed = connectorCaptureCompleteResultV2Schema.parse(
    await dependencies.handoff.complete({ grant, manifest, signal: input.signal }),
  )
  if (completed.operationId !== input.identity.operationId ||
    completed.manifestId !== manifest.manifestId) {
    throw new ImmutableSnapshotError('handoff-invalid', false, 'Snapshot completion binding differs')
  }
  if (completed.outcome === 'incomplete') {
    const missing = [...new Set(completed.missingSequences)].sort((left, right) => left - right)
    if (missing.length === 0 || missing.some((value) => value >= manifest.chunkCount) ||
      JSON.stringify(missing) !== JSON.stringify(completed.missingSequences) ||
      completed.snapshotId !== null || completed.snapshotVersion !== null) {
      throw new ImmutableSnapshotError('handoff-invalid', false, 'Incomplete snapshot receipt is invalid')
    }
    return { status: 'incomplete', manifest, missingSequences: completed.missingSequences }
  }
  if (completed.missingSequences.length !== 0 || completed.snapshotId === null ||
    completed.snapshotVersion === null) {
    throw new ImmutableSnapshotError('handoff-invalid', false, 'Completed snapshot receipt is invalid')
  }
  return { status: completed.outcome, manifest,
    snapshotId: completed.snapshotId, snapshotVersion: completed.snapshotVersion }
}

import {
  connectorCaptureChunkPayloadV2Schema,
  connectorCaptureChunkV2Schema,
  connectorCaptureManifestDigestInputV2,
  connectorCaptureManifestV2Schema,
  type ConnectorCaptureManifestV2,
  type SourceAcquisitionKind,
} from '@place/contracts/transfers'

import type { ConnectorSnapshotChunkDescriptor } from './ports/snapshot-handoff.js'
import { requireNotAborted, sha256, utf8Bytes } from './commitment.js'
import {
  ImmutableSnapshotError,
  type ImmutableSnapshotInput,
  type ImmutableSnapshotRuntimeDependencies,
} from './model.js'

function itemCount(payload: ReturnType<typeof connectorCaptureChunkPayloadV2Schema.parse>): number {
  return payload.lists.reduce((total, list) => total + list.items.length, 0)
}

async function requireBoundProviderAccount(
  dependencies: ImmutableSnapshotRuntimeDependencies,
  input: ImmutableSnapshotInput,
): Promise<void> {
  const activeAccountFingerprint = await dependencies.accountFingerprint.read({
    signal: input.signal,
  })
  if (!/^[a-f0-9]{64}$/.test(activeAccountFingerprint) ||
    activeAccountFingerprint !== input.identity.accountFingerprint) {
    throw new ImmutableSnapshotError('binding-mismatch', false, 'Active Provider account differs')
  }
}

/** Collects and seals one immutable Provider snapshot; it never performs network handoff. */
export async function collectImmutableSnapshot(
  dependencies: ImmutableSnapshotRuntimeDependencies,
  input: ImmutableSnapshotInput,
  observedAt: string,
  capturedAt: string,
): Promise<ConnectorCaptureManifestV2> {
  await input.onProgress?.({
    phase: 'checking-session', capturedChunks: 0, capturedItems: 0,
    uploadedChunks: 0, uploadedItems: 0,
  })
  const session = await dependencies.session.probe({ signal: input.signal })
  if (session === 'reauth-required') {
    throw new ImmutableSnapshotError('reauth-required', false, 'Provider reauthentication is required')
  }
  if (session === 'unavailable') {
    throw new ImmutableSnapshotError('provider-unavailable', true, 'Provider session is unavailable')
  }
  await requireBoundProviderAccount(dependencies, input)

  const descriptors: ConnectorSnapshotChunkDescriptor[] = []
  const listIds = new Set<string>()
  let totalItems = 0
  let totalBytes = 0
  let acquisitionKind: SourceAcquisitionKind | undefined
  for await (const capture of dependencies.source.collect({ signal: input.signal })) {
    requireNotAborted(input.signal)
    if (acquisitionKind === undefined) acquisitionKind = capture.acquisitionKind
    if (capture.acquisitionKind !== acquisitionKind) {
      throw new ImmutableSnapshotError(
        'capture-invalid', false, 'One immutable snapshot cannot mix acquisition strategies',
      )
    }
    let payload
    try {
      payload = connectorCaptureChunkPayloadV2Schema.parse(dependencies.normalizer.normalize(capture))
    } catch {
      throw new ImmutableSnapshotError('capture-invalid', false, 'Provider capture cannot be normalized')
    }
    const normalizedItemCount = itemCount(payload)
    if (normalizedItemCount !== capture.itemCount) {
      throw new ImmutableSnapshotError('capture-invalid', false, 'Provider capture item count differs')
    }
    for (const list of payload.lists) listIds.add(list.sourceListId)
    const serialized = JSON.stringify(payload)
    const chunkBytes = utf8Bytes(serialized)
    const sequence = descriptors.length
    const nextItems = totalItems + normalizedItemCount
    const nextBytes = totalBytes + chunkBytes
    if (
      sequence + 1 > dependencies.limits.maximumChunks || normalizedItemCount > 10_000 ||
      chunkBytes > dependencies.limits.maximumChunkBytes ||
      nextItems > dependencies.limits.maximumItems || nextBytes > dependencies.limits.maximumBytes
    ) throw new ImmutableSnapshotError('capture-invalid', false, 'Provider capture exceeds limits')
    const chunk = connectorCaptureChunkV2Schema.parse({
      schemaVersion: 'connector-capture-chunk.v2', operationId: input.identity.operationId,
      manifestId: input.identity.manifestId, sequence, itemCount: normalizedItemCount,
      byteCount: chunkBytes, checksum: await sha256(serialized), payload: serialized,
    })
    const staged = await dependencies.spool.stage({
      identity: input.identity, chunk, signal: input.signal,
    })
    if (staged === 'conflict') {
      throw new ImmutableSnapshotError('capture-conflict', false, 'Immutable snapshot chunk differs')
    }
    descriptors.push({
      sequence: chunk.sequence, itemCount: chunk.itemCount,
      byteCount: chunk.byteCount, checksum: chunk.checksum,
    })
    totalItems = nextItems
    totalBytes = nextBytes
    await input.onProgress?.({
      phase: 'collecting', capturedChunks: sequence + 1, capturedItems: totalItems,
      uploadedChunks: 0, uploadedItems: 0,
    })
  }
  if (descriptors.length === 0) {
    throw new ImmutableSnapshotError('capture-invalid', false, 'Provider produced no snapshot chunk')
  }

  const withoutDigest = {
    manifestId: input.identity.manifestId,
    sourceRevision: await sha256(JSON.stringify(descriptors)),
    provenance: {
      acquisitionKind: acquisitionKind!,
      parserVersion: dependencies.normalizer.parserVersion,
    },
    observedAt, capturedAt, chunkCount: descriptors.length, listCount: listIds.size,
    itemCount: totalItems, byteCount: totalBytes,
  }
  const manifest = connectorCaptureManifestV2Schema.parse({
    ...withoutDigest,
    manifestDigest: await sha256(connectorCaptureManifestDigestInputV2({
      operationId: input.identity.operationId, connectionId: input.identity.connectionId,
      providerKey: input.identity.providerKey,
      accountFingerprint: input.identity.accountFingerprint,
      installationId: input.identity.installationId,
      manifest: withoutDigest, chunks: descriptors,
    })),
  })
  await requireBoundProviderAccount(dependencies, input)
  if (await dependencies.spool.seal({
    identity: input.identity, manifest, signal: input.signal,
  }) === 'conflict') {
    throw new ImmutableSnapshotError('capture-conflict', false, 'Immutable snapshot manifest differs')
  }
  return manifest
}

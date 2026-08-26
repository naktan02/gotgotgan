import { createHash } from 'node:crypto'

import type {
  ConnectorCaptureBatch,
  ConnectorCaptureReceipt,
  ConnectorGrant,
  ConnectorGrantRequest,
} from '@place/contracts/connector'

import { fingerprint } from './fingerprint.js'
import type { CaptureArtifactStore } from './ports/capture-artifact-store.js'
import type { ConnectorCaptureParser } from './ports/connector-capture-parser.js'
import type {
  ConnectorCaptureRejection,
  ConnectorImportLimits,
  ConnectorImportStore,
} from './ports/connector-import-store.js'
import type { ConnectedPlaceItem } from './ports/connected-place-source.js'
import type { PreparedImportItem } from './ports/import-worker-store.js'

export type ConnectorReceiverRejection =
  | ConnectorCaptureRejection
  | 'unsupported-provider'
  | 'capture-invalid'

type ReceiverConfig = Readonly<{
  publicOrigin: string
  grantTtlMilliseconds: number
  captureRetentionMilliseconds: number
  limits: ConnectorImportLimits
}>

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function preparedItem(item: ConnectedPlaceItem, nextId: () => string): PreparedImportItem {
  const prepared = {
    ...item,
    itemId: nextId(),
    observationId: nextId(),
    candidateId: nextId(),
    decisionId: nextId(),
    proposedPlaceId: nextId(),
  }
  return item.providerPlaceId === undefined || item.reviewReasons.length > 0
    ? prepared
    : {
        ...prepared,
        fulfillment: {
          jobId: nextId(),
          observationId: nextId(),
          candidateId: nextId(),
          decisionId: nextId(),
          proposedPlaceId: nextId(),
        },
      }
}

export function createConnectorImportReceiver(dependencies: Readonly<{
  store: ConnectorImportStore
  artifacts: CaptureArtifactStore
  parsers: readonly ConnectorCaptureParser[]
  config: ReceiverConfig
  nextId: () => string
  nextToken: () => string
  now: () => Date
}>) {
  const parsers = new Map(dependencies.parsers.map((parser) => [parser.providerKey, parser]))
  if (parsers.size !== dependencies.parsers.length) throw new Error('Connector parser keys must be unique')

  return {
    async issueGrant(input: Readonly<{
      memberId: string
      publicOrigin: string
      request: ConnectorGrantRequest
    }>): Promise<
      | Readonly<{ status: 'created' | 'replayed'; grant: ConnectorGrant }>
      | Readonly<{ status: 'rejected'; reason: 'origin-mismatch' | 'unsupported-provider' | 'operation-conflict' }>
    > {
      if (input.publicOrigin !== dependencies.config.publicOrigin) {
        return { status: 'rejected', reason: 'origin-mismatch' }
      }
      if (!parsers.has(input.request.providerKey)) {
        return { status: 'rejected', reason: 'unsupported-provider' }
      }
      const issuedAt = dependencies.now()
      const token = dependencies.nextToken()
      const expiresAt = new Date(
        issuedAt.getTime() + dependencies.config.grantTtlMilliseconds,
      ).toISOString()
      const result = await dependencies.store.issueGrant({
        operationId: dependencies.nextId(),
        memberId: input.memberId,
        connectionId: dependencies.nextId(),
        batchId: dependencies.nextId(),
        installationId: input.request.installationId,
        browserKey: input.request.browserKey,
        providerKey: input.request.providerKey,
        idempotencyKey: input.request.idempotencyKey,
        requestFingerprint: fingerprint({ request: input.request, publicOrigin: input.publicOrigin }),
        tokenDigest: digest(token),
        placeOrigin: input.publicOrigin,
        expiresAt,
        limits: dependencies.config.limits,
        issuedAt: issuedAt.toISOString(),
      })
      if (result.status === 'conflict' || result.status === 'closed') {
        return { status: 'rejected', reason: 'operation-conflict' }
      }
      return {
        status: result.status,
        grant: {
          schemaVersion: 'place-connector-grant.v1',
          operationId: result.operationId,
          providerKey: input.request.providerKey,
          operation: input.request.operation,
          idempotencyKey: input.request.idempotencyKey,
          token,
          placeOrigin: input.publicOrigin,
          expiresAt,
          limits: dependencies.config.limits,
        },
      }
    },

    async submitCapture(input: Readonly<{
      token: string
      publicOrigin: string
      batch: ConnectorCaptureBatch
    }>): Promise<
      | Readonly<{ status: 'accepted' | 'replayed'; receipt: ConnectorCaptureReceipt }>
      | Readonly<{ status: 'rejected'; reason: ConnectorReceiverRejection }>
    > {
      if (input.publicOrigin !== dependencies.config.publicOrigin) {
        return { status: 'rejected', reason: 'origin-mismatch' }
      }
      const parser = parsers.get(input.batch.providerKey)
      if (parser === undefined) return { status: 'rejected', reason: 'unsupported-provider' }
      const body = new TextEncoder().encode(input.batch.payload)
      if (digest(body) !== input.batch.checksum) {
        return { status: 'rejected', reason: 'capture-invalid' }
      }
      const observedAt = dependencies.now()
      const parsed = parser.parse({
        body,
        contentType: input.batch.contentType,
        observedAt: observedAt.toISOString(),
      })
      if (
        parsed.kind !== 'page' || parsed.nextCursor !== null ||
        parsed.items.length !== input.batch.itemCount
      ) return { status: 'rejected', reason: 'capture-invalid' }

      const retentionUntil = new Date(
        observedAt.getTime() + dependencies.config.captureRetentionMilliseconds,
      ).toISOString()
      const artifactId = dependencies.nextId()
      const reservation = await dependencies.store.beginCapture({
        operationId: input.batch.operationId,
        tokenDigest: digest(input.token),
        placeOrigin: input.publicOrigin,
        providerKey: input.batch.providerKey,
        sequence: input.batch.sequence,
        final: input.batch.final,
        itemCount: input.batch.itemCount,
        byteCount: body.byteLength,
        checksum: input.batch.checksum,
        artifactId,
        artifactReference: `capture:${artifactId}`,
        parserVersion: parser.parserVersion,
        acquisitionKind: parser.acquisitionKind,
        observedAt: observedAt.toISOString(),
        retentionUntil,
        reservedAt: observedAt.toISOString(),
      })
      if (reservation.status === 'rejected') return reservation
      if (reservation.status === 'replayed') {
        return { status: 'replayed', receipt: reservation.receipt }
      }
      const artifact = await dependencies.artifacts.put({
        artifactId: reservation.artifactId,
        batchId: reservation.importBatchId,
        providerKey: input.batch.providerKey,
        body,
        checksum: input.batch.checksum,
        contentType: input.batch.contentType,
        retentionUntil: reservation.retentionUntil,
      })
      if (artifact.checksum !== input.batch.checksum) {
        return { status: 'rejected', reason: 'capture-invalid' }
      }
      const committed = await dependencies.store.commitCapture({
        operationId: input.batch.operationId,
        tokenDigest: digest(input.token),
        sequence: input.batch.sequence,
        checksum: input.batch.checksum,
        items: parsed.items.map((item) => preparedItem(item, dependencies.nextId)),
        committedAt: dependencies.now().toISOString(),
      })
      if (committed.status === 'rejected') return committed
      return {
        status: committed.status === 'committed' ? 'accepted' : 'replayed',
        receipt: committed.receipt,
      }
    },
  }
}

export type ConnectorImportReceiver = ReturnType<typeof createConnectorImportReceiver>

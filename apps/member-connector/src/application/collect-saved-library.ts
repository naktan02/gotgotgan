import {
  connectorCaptureBatchSchema,
  connectorCaptureReceiptSchema,
  connectorGrantSchema,
  type ConnectorGrant,
  type ConnectorResultCode,
} from '@place/contracts/connector'

import type { CaptureSubmission } from './ports/capture-submission.js'
import type { ProviderSession } from './ports/provider-session.js'
import type {
  SavedPlaceCapturePayload,
  SavedPlaceSource,
} from './ports/saved-place-source.js'

export type CollectionProgress = Readonly<{
  phase: 'checking-session' | 'collecting' | 'submitting' | 'finalizing'
  discoveredItems: number
  capturedItems: number
  submittedItems: number
  submittedBatches: number
}>

export type SavedLibraryCollectionResult = Readonly<{
  importBatchId: string
  itemCount: number
  batchCount: number
  byteCount: number
}>

export class ConnectorOperationError extends Error {
  constructor(
    readonly code: ConnectorResultCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'ConnectorOperationError'
  }
}

type Dependencies = Readonly<{
  session: ProviderSession
  source: SavedPlaceSource
  submission: CaptureSubmission
  now?: () => Date
}>

type Input = Readonly<{
  grant: ConnectorGrant
  signal: AbortSignal
  onProgress?: (progress: CollectionProgress) => void | Promise<void>
}>

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason
}

function operationError(
  code: ConnectorResultCode,
  retryable: boolean,
  message: string,
): ConnectorOperationError {
  return new ConnectorOperationError(code, retryable, message)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

async function checksum(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
}

function assertJsonBatch(batch: SavedPlaceCapturePayload): void {
  if (!Number.isInteger(batch.itemCount) || batch.itemCount < 0 || batch.itemCount > 500) {
    throw operationError('provider-drift', false, 'Provider capture batch item count is invalid')
  }
  try {
    JSON.parse(batch.payload)
  } catch {
    throw operationError('provider-drift', false, 'Provider capture batch is not valid JSON')
  }
}

function assertNotExpired(grant: ConnectorGrant, now: Date): void {
  if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
    throw operationError('upload-rejected', false, 'Connector grant expired')
  }
}

export async function collectSavedLibrary(
  dependencies: Dependencies,
  input: Input,
): Promise<SavedLibraryCollectionResult> {
  const grant = connectorGrantSchema.parse(input.grant)
  if (
    dependencies.session.providerKey !== grant.providerKey ||
    dependencies.source.providerKey !== grant.providerKey
  ) throw operationError('invalid-request', false, 'Connector provider mismatch')

  const currentTime = dependencies.now ?? (() => new Date())
  assertNotExpired(grant, currentTime())
  const progress: CollectionProgress = {
    phase: 'checking-session',
    discoveredItems: 0,
    capturedItems: 0,
    submittedItems: 0,
    submittedBatches: 0,
  }
  await input.onProgress?.(progress)
  aborted(input.signal)

  const sessionState = await dependencies.session.probe({ signal: input.signal })
  if (sessionState === 'reauth-required') {
    throw operationError('reauth-required', false, 'Provider reauthentication is required')
  }
  if (sessionState === 'unavailable') {
    throw operationError('provider-unavailable', true, 'Provider session is unavailable')
  }

  await input.onProgress?.({ ...progress, phase: 'collecting' })
  const iterator = dependencies.source.collect({ signal: input.signal })[Symbol.asyncIterator]()
  let current = await iterator.next()
  let sequence = 0
  let itemCount = 0
  let byteCount = 0
  let importBatchId: string | undefined

  if (current.done) {
    throw operationError('provider-drift', false, 'Provider source produced no capture document')
  }

  while (!current.done) {
    aborted(input.signal)
    const next = await iterator.next()
    const final = next.done === true
    const capture = current.value
    assertJsonBatch(capture)
    const captureBytes = byteLength(capture.payload)
    const nextItemCount = itemCount + capture.itemCount
    const nextByteCount = byteCount + captureBytes
    const nextBatchCount = sequence + 1
    if (
      captureBytes > grant.limits.maximumBatchBytes ||
      nextItemCount > grant.limits.maximumItems ||
      nextByteCount > grant.limits.maximumBytes ||
      nextBatchCount > grant.limits.maximumBatches
    ) throw operationError('upload-rejected', false, 'Connector capture exceeded grant limits')

    await input.onProgress?.({
      phase: 'submitting',
      discoveredItems: nextItemCount,
      capturedItems: nextItemCount,
      submittedItems: itemCount,
      submittedBatches: sequence,
    })
    assertNotExpired(grant, currentTime())
    const batch = connectorCaptureBatchSchema.parse({
      schemaVersion: 'place-connector-capture-batch.v1',
      operationId: grant.operationId,
      providerKey: grant.providerKey,
      sequence,
      final,
      itemCount: capture.itemCount,
      contentType: 'application/json',
      payload: capture.payload,
      checksum: await checksum(capture.payload),
    })
    const receipt = connectorCaptureReceiptSchema.parse(
      await dependencies.submission.submit({ grant, batch, signal: input.signal }),
    )
    if (
      receipt.operationId !== grant.operationId ||
      receipt.acceptedSequence !== sequence ||
      receipt.acceptedChecksum !== batch.checksum ||
      receipt.receivedItems !== nextItemCount ||
      receipt.receivedBytes !== nextByteCount ||
      (importBatchId !== undefined && receipt.importBatchId !== importBatchId)
    ) throw operationError('upload-rejected', false, 'Connector capture receipt did not match')

    importBatchId = receipt.importBatchId
    itemCount = nextItemCount
    byteCount = nextByteCount
    sequence = nextBatchCount
    await input.onProgress?.({
      phase: final ? 'finalizing' : 'collecting',
      discoveredItems: itemCount,
      capturedItems: itemCount,
      submittedItems: itemCount,
      submittedBatches: sequence,
    })
    if (final) break
    current = next
  }

  if (importBatchId === undefined) {
    throw operationError('upload-rejected', false, 'Connector capture produced no receipt')
  }
  return { importBatchId, itemCount, batchCount: sequence, byteCount }
}

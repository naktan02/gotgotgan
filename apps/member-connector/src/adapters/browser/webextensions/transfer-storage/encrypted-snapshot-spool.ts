import {
  connectorCaptureChunkV2Schema,
  connectorCaptureManifestV2Schema,
  type ConnectorCaptureChunkV2,
} from '@place/contracts/transfers'
import { z } from 'zod'

import type {
  ConnectorSnapshotIdentity,
  ConnectorSnapshotSpool,
  ConnectorSnapshotSpoolStatus,
} from '../../../../application/import-snapshot/index.js'
import { AuthenticatedEnvelopeCodec, AuthenticatedEnvelopeError } from './authenticated-envelope.js'
import { readStoredValue, type WebExtensionStorageArea } from './storage-area.js'

const identitySchema = z.object({
  operationId: z.uuid(),
  connectionId: z.uuid(),
  providerKey: z.enum(['naver', 'kakao', 'google']),
  accountFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  installationId: z.uuid(),
  manifestId: z.uuid(),
}).strict()

const indexSchema = z.object({
  schemaVersion: z.literal('connector-encrypted-snapshot-index.v1'),
  identity: identitySchema,
  state: z.enum(['collecting', 'sealed']),
  observedAt: z.iso.datetime({ offset: true }),
  capturedAt: z.iso.datetime({ offset: true }),
  stagedChunkCount: z.number().int().nonnegative().max(1_000),
  stagedItemCount: z.number().int().nonnegative().max(100_000),
  stagedByteCount: z.number().int().nonnegative().max(134_217_728),
  manifest: connectorCaptureManifestV2Schema.nullable(),
}).strict()

type SnapshotIndex = z.infer<typeof indexSchema>

export type EncryptedSnapshotSpoolLimits = Readonly<{
  maximumSnapshots: number
  maximumChunksPerSnapshot: number
  maximumChunkBytes: number
  maximumStoredBytes: number
}>

export class EncryptedSnapshotSpoolError extends Error {
  constructor(readonly code: 'configuration-invalid' | 'corrupted' | 'limit-exceeded') {
    super(`Encrypted snapshot spool ${code}`)
    this.name = 'EncryptedSnapshotSpoolError'
  }
}

const prefix = 'gkg:transfer:snapshot:v1:'
const encoder = new TextEncoder()

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertLimits(limits: EncryptedSnapshotSpoolLimits): void {
  if (
    !Number.isInteger(limits.maximumSnapshots) || limits.maximumSnapshots < 1 ||
    !Number.isInteger(limits.maximumChunksPerSnapshot) ||
    limits.maximumChunksPerSnapshot < 1 || limits.maximumChunksPerSnapshot > 1_000 ||
    !Number.isInteger(limits.maximumChunkBytes) || limits.maximumChunkBytes < 2 ||
    limits.maximumChunkBytes > 4_194_304 ||
    !Number.isInteger(limits.maximumStoredBytes) ||
    limits.maximumStoredBytes < limits.maximumChunkBytes
  ) throw new EncryptedSnapshotSpoolError('configuration-invalid')
}

async function identityDigest(identity: ConnectorSnapshotIdentity, cryptography: Crypto): Promise<string> {
  const normalized = identitySchema.parse(identity)
  const digest = await cryptography.subtle.digest(
    'SHA-256', encoder.encode(JSON.stringify(normalized)),
  )
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function indexKey(digest: string): string { return `${prefix}${digest}:index` }
function chunkKey(digest: string, sequence: number): string {
  return `${prefix}${digest}:chunk:${sequence.toString().padStart(4, '0')}`
}

function status(index: SnapshotIndex): ConnectorSnapshotSpoolStatus {
  return index.state === 'sealed'
    ? { state: 'sealed', manifest: connectorCaptureManifestV2Schema.parse(index.manifest) }
    : { state: 'collecting', observedAt: index.observedAt, capturedAt: index.capturedAt }
}

/** Immutable encrypted chunk spool; all mutations are serialized in the sole extension background. */
export class WebExtensionEncryptedSnapshotSpool implements ConnectorSnapshotSpool {
  private mutation: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: WebExtensionStorageArea,
    private readonly envelopes: AuthenticatedEnvelopeCodec,
    private readonly limits: EncryptedSnapshotSpoolLimits,
    private readonly cryptography: Crypto = globalThis.crypto,
  ) { assertLimits(limits) }

  private async exclusively<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await work() } finally { release() }
  }

  private async readIndex(key: string): Promise<SnapshotIndex | null> {
    const stored = await readStoredValue(this.storage, key)
    if (stored === undefined) return null
    try {
      return indexSchema.parse(await this.envelopes.open(key, 'snapshot-index', stored))
    } catch (error) {
      if (error instanceof AuthenticatedEnvelopeError || error instanceof z.ZodError) {
        throw new EncryptedSnapshotSpoolError('corrupted')
      }
      throw error
    }
  }

  private async assertBoundedWrite(key: string, value: unknown): Promise<void> {
    const all = await this.storage.get(null)
    const snapshotIndexes = Object.keys(all).filter((candidate) =>
      candidate.startsWith(prefix) && candidate.endsWith(':index'))
    if (!(key in all) && key.endsWith(':index') && snapshotIndexes.length >= this.limits.maximumSnapshots) {
      throw new EncryptedSnapshotSpoolError('limit-exceeded')
    }
    let bytes = 0
    for (const [storedKey, storedValue] of Object.entries(all)) {
      if (storedKey.startsWith(prefix) && storedKey !== key) {
        bytes += encoder.encode(JSON.stringify(storedValue)).byteLength
      }
    }
    bytes += encoder.encode(JSON.stringify(value)).byteLength
    if (bytes > this.limits.maximumStoredBytes) {
      throw new EncryptedSnapshotSpoolError('limit-exceeded')
    }
  }

  private async writeIndex(key: string, index: SnapshotIndex): Promise<void> {
    const envelope = await this.envelopes.seal(key, 'snapshot-index', indexSchema.parse(index))
    await this.assertBoundedWrite(key, envelope)
    await this.storage.set({ [key]: envelope })
  }

  async open(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    observedAt: string
    capturedAt: string
    signal: AbortSignal
  }>): Promise<ConnectorSnapshotSpoolStatus> {
    if (input.signal.aborted) throw input.signal.reason
    return this.exclusively(async () => {
      const identity = identitySchema.parse(input.identity)
      const digest = await identityDigest(identity, this.cryptography)
      const key = indexKey(digest)
      const existing = await this.readIndex(key)
      if (existing !== null) {
        if (!same(existing.identity, identity)) throw new EncryptedSnapshotSpoolError('corrupted')
        return status(existing)
      }
      const observedAt = new Date(input.observedAt).toISOString()
      const capturedAt = new Date(input.capturedAt).toISOString()
      const created = indexSchema.parse({
        schemaVersion: 'connector-encrypted-snapshot-index.v1', identity,
        state: 'collecting', observedAt, capturedAt,
        stagedChunkCount: 0, stagedItemCount: 0, stagedByteCount: 0, manifest: null,
      })
      await this.writeIndex(key, created)
      return status(created)
    })
  }

  async stage(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    chunk: ConnectorCaptureChunkV2
    signal: AbortSignal
  }>): Promise<'recorded' | 'replayed' | 'conflict'> {
    if (input.signal.aborted) throw input.signal.reason
    return this.exclusively(async () => {
      const identity = identitySchema.parse(input.identity)
      const chunk = connectorCaptureChunkV2Schema.parse(input.chunk)
      if (
        chunk.operationId !== identity.operationId || chunk.manifestId !== identity.manifestId ||
        chunk.byteCount > this.limits.maximumChunkBytes ||
        chunk.sequence >= this.limits.maximumChunksPerSnapshot
      ) return 'conflict'
      const digest = await identityDigest(identity, this.cryptography)
      const metadataKey = indexKey(digest)
      const metadata = await this.readIndex(metadataKey)
      if (metadata === null || !same(metadata.identity, identity)) return 'conflict'
      const valueKey = chunkKey(digest, chunk.sequence)
      const existing = await readStoredValue(this.storage, valueKey)
      if (existing !== undefined) {
        let previous: ConnectorCaptureChunkV2
        try {
          previous = connectorCaptureChunkV2Schema.parse(
            await this.envelopes.open(valueKey, 'snapshot-chunk', existing),
          )
        } catch {
          throw new EncryptedSnapshotSpoolError('corrupted')
        }
        if (!same(previous, chunk)) return 'conflict'
        if (chunk.sequence < metadata.stagedChunkCount) return 'replayed'
        if (metadata.state !== 'collecting' || chunk.sequence !== metadata.stagedChunkCount) {
          return 'conflict'
        }
        await this.advanceIndex(metadataKey, metadata, chunk)
        return 'replayed'
      }
      if (metadata.state !== 'collecting' || chunk.sequence !== metadata.stagedChunkCount) {
        return 'conflict'
      }
      const envelope = await this.envelopes.seal(valueKey, 'snapshot-chunk', chunk)
      await this.assertBoundedWrite(valueKey, envelope)
      await this.storage.set({ [valueKey]: envelope })
      await this.advanceIndex(metadataKey, metadata, chunk)
      return 'recorded'
    })
  }

  private async advanceIndex(
    key: string,
    index: SnapshotIndex,
    chunk: ConnectorCaptureChunkV2,
  ): Promise<void> {
    const nextItems = index.stagedItemCount + chunk.itemCount
    const nextBytes = index.stagedByteCount + chunk.byteCount
    if (nextItems > 100_000 || nextBytes > 134_217_728) {
      throw new EncryptedSnapshotSpoolError('limit-exceeded')
    }
    await this.writeIndex(key, {
      ...index,
      stagedChunkCount: index.stagedChunkCount + 1,
      stagedItemCount: nextItems,
      stagedByteCount: nextBytes,
    })
  }

  async seal(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    manifest: z.infer<typeof connectorCaptureManifestV2Schema>
    signal: AbortSignal
  }>): Promise<'sealed' | 'replayed' | 'conflict'> {
    if (input.signal.aborted) throw input.signal.reason
    return this.exclusively(async () => {
      const identity = identitySchema.parse(input.identity)
      const manifest = connectorCaptureManifestV2Schema.parse(input.manifest)
      const digest = await identityDigest(identity, this.cryptography)
      const key = indexKey(digest)
      const index = await this.readIndex(key)
      if (index === null || !same(index.identity, identity)) return 'conflict'
      if (index.state === 'sealed') return same(index.manifest, manifest) ? 'replayed' : 'conflict'
      if (
        manifest.manifestId !== identity.manifestId ||
        manifest.chunkCount !== index.stagedChunkCount ||
        manifest.itemCount !== index.stagedItemCount ||
        manifest.byteCount !== index.stagedByteCount
      ) return 'conflict'
      for (let sequence = 0; sequence < manifest.chunkCount; sequence += 1) {
        if (await readStoredValue(this.storage, chunkKey(digest, sequence)) === undefined) {
          throw new EncryptedSnapshotSpoolError('corrupted')
        }
      }
      await this.writeIndex(key, { ...index, state: 'sealed', manifest })
      return 'sealed'
    })
  }

  async *read(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    fromSequence: number
    signal: AbortSignal
  }>): AsyncIterable<ConnectorCaptureChunkV2> {
    const identity = identitySchema.parse(input.identity)
    const digest = await identityDigest(identity, this.cryptography)
    const index = await this.readIndex(indexKey(digest))
    if (
      index?.state !== 'sealed' || !same(index.identity, identity) ||
      !Number.isInteger(input.fromSequence) || input.fromSequence < 0 ||
      input.fromSequence > index.stagedChunkCount
    ) throw new EncryptedSnapshotSpoolError('corrupted')
    for (let sequence = input.fromSequence; sequence < index.stagedChunkCount; sequence += 1) {
      if (input.signal.aborted) throw input.signal.reason
      const key = chunkKey(digest, sequence)
      const stored = await readStoredValue(this.storage, key)
      if (stored === undefined) throw new EncryptedSnapshotSpoolError('corrupted')
      try {
        const chunk = connectorCaptureChunkV2Schema.parse(
          await this.envelopes.open(key, 'snapshot-chunk', stored),
        )
        if (chunk.sequence !== sequence) throw new EncryptedSnapshotSpoolError('corrupted')
        yield chunk
      } catch (error) {
        if (error instanceof EncryptedSnapshotSpoolError) throw error
        throw new EncryptedSnapshotSpoolError('corrupted')
      }
    }
  }

  async remove(identity: ConnectorSnapshotIdentity): Promise<void> {
    await this.exclusively(async () => {
      const digest = await identityDigest(identitySchema.parse(identity), this.cryptography)
      const index = await this.readIndex(indexKey(digest))
      if (index === null) return
      const keys = [indexKey(digest), ...Array.from(
        { length: index.stagedChunkCount }, (_, sequence) => chunkKey(digest, sequence),
      )]
      await this.storage.remove(keys)
    })
  }
}

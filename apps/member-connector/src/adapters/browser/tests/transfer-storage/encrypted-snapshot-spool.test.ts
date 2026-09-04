import type { ConnectorCaptureChunkV2, ConnectorCaptureManifestV2 } from '@place/contracts/transfers'
import { describe, expect, it } from 'vitest'

import type { ConnectorSnapshotIdentity } from '../../../../application/import-snapshot/index.js'
import {
  AuthenticatedEnvelopeCodec,
  WebExtensionEncryptedSnapshotSpool,
} from '../../webextensions/transfer-storage/index.js'
import { MemoryWebExtensionStorage, nonExtractableAesKey } from './memory-storage.js'

const identity: ConnectorSnapshotIdentity = {
  operationId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  providerKey: 'naver',
  accountFingerprint: 'a'.repeat(64),
  installationId: '33333333-3333-4333-8333-333333333333',
  manifestId: '44444444-4444-4444-8444-444444444444',
}
const payload = JSON.stringify({ lists: [{
  sourceListId: 'list-private', observedName: '도쿄 여행', sourcePosition: 0,
  items: [{
    sourceItemId: 'item-private', providerPlaceId: 'provider-private',
    observedName: '비공개 장소', observedAddress: null, observedCategory: null,
    observedLocation: null, sourcePosition: 0,
  }],
}] })
const chunk: ConnectorCaptureChunkV2 = {
  schemaVersion: 'connector-capture-chunk.v2',
  operationId: identity.operationId,
  manifestId: identity.manifestId,
  sequence: 0,
  itemCount: 1,
  byteCount: new TextEncoder().encode(payload).byteLength,
  checksum: 'b'.repeat(64),
  payload,
}
const manifest: ConnectorCaptureManifestV2 = {
  manifestId: identity.manifestId,
  manifestDigest: 'c'.repeat(64),
  sourceRevision: 'snapshot-r1',
  observedAt: '2026-09-04T00:00:00.000Z',
  capturedAt: '2026-09-04T00:00:00.000Z',
  chunkCount: 1,
  listCount: 1,
  itemCount: 1,
  byteCount: chunk.byteCount,
}
const limits = {
  maximumSnapshots: 2,
  maximumChunksPerSnapshot: 10,
  maximumChunkBytes: 1_000_000,
  maximumStoredBytes: 2_000_000,
}

async function fixture(storage = new MemoryWebExtensionStorage(), key?: CryptoKey) {
  const encryptionKey = key ?? await nonExtractableAesKey()
  const codec = new AuthenticatedEnvelopeCodec(encryptionKey, 'test-key-v1', 1_100_000)
  return {
    storage,
    key: encryptionKey,
    spool: new WebExtensionEncryptedSnapshotSpool(storage, codec, limits),
  }
}

describe('WebExtensionEncryptedSnapshotSpool', () => {
  it('persists an immutable encrypted snapshot and resumes it after adapter restart', async () => {
    const first = await fixture()
    const signal = new AbortController().signal
    await expect(first.spool.open({
      identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal,
    })).resolves.toMatchObject({ state: 'collecting' })
    await expect(first.spool.stage({ identity, chunk, signal })).resolves.toBe('recorded')
    await expect(first.spool.seal({ identity, manifest, signal })).resolves.toBe('sealed')

    const serialized = JSON.stringify(first.storage.dump())
    expect(serialized).not.toContain('비공개 장소')
    expect(serialized).not.toContain('list-private')
    expect(serialized).not.toContain(identity.accountFingerprint)

    const restarted = await fixture(first.storage, first.key)
    await expect(restarted.spool.open({
      identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal,
    })).resolves.toEqual({ state: 'sealed', manifest })
    const recovered: ConnectorCaptureChunkV2[] = []
    for await (const value of restarted.spool.read({ identity, fromSequence: 0, signal })) {
      recovered.push(value)
    }
    expect(recovered).toEqual([chunk])
  })

  it('fails closed on storage loss, ciphertext corruption, or a different restart key', async () => {
    const value = await fixture()
    const signal = new AbortController().signal
    await value.spool.open({
      identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal,
    })
    await value.spool.stage({ identity, chunk, signal })
    await value.spool.seal({ identity, manifest, signal })

    const missing = await fixture(new MemoryWebExtensionStorage(), value.key)
    await expect(missing.spool.open({
      identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal,
    })).resolves.toMatchObject({ state: 'collecting' })

    value.storage.corrupt((key) => key.endsWith(':chunk:0000'))
    const corrupted = await fixture(value.storage, value.key)
    const reading = async () => {
      for await (const _value of corrupted.spool.read({ identity, fromSequence: 0, signal })) {}
    }
    await expect(reading()).rejects.toMatchObject({ code: 'corrupted' })

    const wrongKey = await fixture(value.storage)
    await expect(wrongKey.spool.open({
      identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal,
    })).rejects.toMatchObject({ code: 'corrupted' })
  })

  it('rejects overwrite and bounded-storage overflow instead of evicting evidence', async () => {
    const value = await fixture()
    const signal = new AbortController().signal
    await value.spool.open({
      identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal,
    })
    await expect(value.spool.stage({ identity, chunk, signal })).resolves.toBe('recorded')
    await expect(value.spool.stage({
      identity, chunk: { ...chunk, checksum: 'd'.repeat(64) }, signal,
    })).resolves.toBe('conflict')

    const tiny = new WebExtensionEncryptedSnapshotSpool(
      new MemoryWebExtensionStorage(),
      new AuthenticatedEnvelopeCodec(await nonExtractableAesKey(), 'test-key-v1', 1_100_000),
      { ...limits, maximumStoredBytes: 1_000_000 },
    )
    await tiny.open({ identity, observedAt: manifest.observedAt, capturedAt: manifest.capturedAt, signal })
    await expect(tiny.stage({ identity, chunk: { ...chunk, payload: 'x'.repeat(900_000),
      byteCount: 900_000 }, signal })).rejects.toMatchObject({ code: 'limit-exceeded' })
  })
})

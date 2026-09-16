import type { OutboundExecutionAuthorizationReceiptV2 } from '@place/contracts/transfers'
import { describe, expect, it } from 'vitest'

import type { OutboundAttemptSeal } from '../../../../application/outbound-export/index.js'
import {
  AuthenticatedEnvelopeCodec,
  WebExtensionOutboundAttemptSpool,
  WebExtensionReconciliationAuthorizationVault,
} from '../../webextensions/transfer-storage/index.js'
import { MemoryWebExtensionStorage, nonExtractableAesKey } from './memory-storage.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const receiptReference = '22222222-2222-4222-8222-222222222222'
const attemptId = '33333333-3333-4333-8333-333333333333'
const token = 'opaque-receipt-token-that-must-never-be-serialized-in-plaintext'
const attempt: OutboundAttemptSeal = {
  schemaVersion: 'outbound-attempt-seal.v1',
  operationId,
  receiptReference,
  attemptId,
  phase: 'add-items',
  targetListId: 'target-list-a',
  sequence: 0,
  final: true,
  requestFingerprint: 'a'.repeat(64),
  planDigest: 'b'.repeat(64),
  reconciliationReference: 'local-reconciliation-a',
  items: [{
    exportItemId: '44444444-4444-4444-8444-444444444444',
    providerPlaceId: 'provider-place-a',
  }],
  sealedAt: '2026-09-04T00:00:00.000Z',
  writeExpiresAt: '2026-09-04T00:05:00.000Z',
  reconciliationExpiresAt: '2026-09-04T01:00:00.000Z',
}
const authorization: OutboundExecutionAuthorizationReceiptV2 = {
  schemaVersion: 'outbound-execution-authorization-receipt.v2',
  status: 'consumed',
  grantId: '55555555-5555-4555-8555-555555555555',
  receiptReference,
  receiptToken: token,
  operationId,
  transferId: '66666666-6666-4666-8666-666666666666',
  connectionId: '77777777-7777-4777-8777-777777777777',
  providerKey: 'naver',
  accountFingerprint: 'c'.repeat(64),
  installationId: '88888888-8888-4888-8888-888888888888',
  planDigest: attempt.planDigest,
  batchSize: 100,
  authorizedAt: attempt.sealedAt,
  expiresAt: attempt.writeExpiresAt,
  reconciliationExpiresAt: attempt.reconciliationExpiresAt,
  limits: { maximumItems: 100, maximumBytes: 10_000, maximumBatches: 10 },
}

async function codec(key?: CryptoKey) {
  const encryptionKey = key ?? await nonExtractableAesKey()
  return {
    key: encryptionKey,
    value: new AuthenticatedEnvelopeCodec(encryptionKey, 'test-key-v1', 100_000),
  }
}

describe('WebExtensionOutboundAttemptSpool', () => {
  it('preserves atomic transitions over restart and removes only after retention', async () => {
    const storage = new MemoryWebExtensionStorage()
    const encryption = await codec()
    const first = new WebExtensionOutboundAttemptSpool(
      storage, encryption.value, { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
    )
    await expect(first.seal(attempt)).resolves.toBe('sealed')
    await expect(first.acknowledgePrepared({
      attemptId, preparedAt: '2026-09-04T00:01:00.000Z',
    })).resolves.toBe('acknowledged')

    const restarted = new WebExtensionOutboundAttemptSpool(
      storage, (await codec(encryption.key)).value,
      { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
    )
    await expect(restarted.load(attemptId)).resolves.toMatchObject({ state: 'prepared', attempt })
    await expect(restarted.acknowledgeReported({
      attemptId, reportedAt: '2026-09-04T00:02:00.000Z',
    })).resolves.toBe('acknowledged')
    await expect(restarted.complete({
      attemptId,
      completedAt: '2026-09-04T00:03:00.000Z',
      retainUntil: '2026-09-05T00:00:00.000Z',
    })).resolves.toBe('completed')
    await expect(restarted.remove({
      attemptId, now: '2026-09-04T12:00:00.000Z',
    })).resolves.toBe('retained')
    await expect(restarted.cleanupExpired({
      now: '2026-09-05T00:00:00.000Z',
    })).resolves.toBe(1)
    await expect(restarted.load(attemptId)).resolves.toBeNull()
  })

  it('fails closed on conflict, storage loss, and ciphertext corruption', async () => {
    const storage = new MemoryWebExtensionStorage()
    const encryption = await codec()
    const spool = new WebExtensionOutboundAttemptSpool(
      storage, encryption.value, { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
    )
    await spool.seal(attempt)
    await expect(spool.seal({ ...attempt, final: false })).resolves.toBe('conflict')
    storage.clear()
    await expect(spool.load(attemptId)).resolves.toBeNull()
    await spool.seal(attempt)
    storage.corrupt((key) => key.includes(attemptId))
    await expect(spool.load(attemptId)).rejects.toMatchObject({ code: 'corrupted' })
  })
})

describe('WebExtensionReconciliationAuthorizationVault', () => {
  it('never stores a plaintext token and can decrypt it after adapter restart', async () => {
    const storage = new MemoryWebExtensionStorage()
    const encryption = await codec()
    const first = new WebExtensionReconciliationAuthorizationVault(
      storage, encryption.value, { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
      () => new Date('2026-09-04T00:02:00.000Z'),
    )
    await expect(first.seal(authorization)).resolves.toBe('sealed')
    expect(JSON.stringify(storage.dump())).not.toContain(token)
    expect(JSON.stringify(storage.dump())).not.toContain('receiptToken')

    const restarted = new WebExtensionReconciliationAuthorizationVault(
      storage, (await codec(encryption.key)).value,
      { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
      () => new Date('2026-09-04T00:03:00.000Z'),
    )
    await expect(restarted.load(receiptReference)).resolves.toEqual(authorization)
  })

  it('rejects extractable keys and fails closed after key loss or ciphertext corruption', async () => {
    const extractable = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    ) as CryptoKey
    expect(() => new AuthenticatedEnvelopeCodec(extractable, 'unsafe-key', 100_000))
      .toThrow('configuration-invalid')

    const storage = new MemoryWebExtensionStorage()
    const encryption = await codec()
    const vault = new WebExtensionReconciliationAuthorizationVault(
      storage, encryption.value, { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
      () => new Date('2026-09-04T00:02:00.000Z'),
    )
    await vault.seal(authorization)
    const wrongKey = new WebExtensionReconciliationAuthorizationVault(
      storage, (await codec()).value, { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
      () => new Date('2026-09-04T00:02:00.000Z'),
    )
    await expect(wrongKey.load(receiptReference)).rejects.toMatchObject({ code: 'corrupted' })
    storage.corrupt((key) => key.includes(receiptReference))
    await expect(vault.load(receiptReference)).rejects.toMatchObject({ code: 'corrupted' })
  })

  it('physically removes expired authorization on bounded cleanup', async () => {
    const storage = new MemoryWebExtensionStorage()
    const encryption = await codec()
    const vault = new WebExtensionReconciliationAuthorizationVault(
      storage, encryption.value, { maximumRecords: 10, maximumStoredBytes: 1_000_000 },
      () => new Date('2026-09-04T00:02:00.000Z'),
    )
    await vault.seal(authorization)
    await expect(vault.removeExpired({
      now: authorization.reconciliationExpiresAt, limit: 10,
    })).resolves.toBe(1)
    await expect(vault.load(receiptReference)).resolves.toBeNull()
  })
})

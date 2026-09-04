import {
  outboundExecutionAuthorizationReceiptV2Schema,
  type OutboundExecutionAuthorizationReceiptV2,
} from '@place/contracts/transfers'

import type {
  OutboundReconciliationAuthorizationVault,
} from '../../../../application/outbound-export/index.js'
import { AuthenticatedEnvelopeCodec, AuthenticatedEnvelopeError } from './authenticated-envelope.js'
import { readStoredValue, type WebExtensionStorageArea } from './storage-area.js'

export type ReconciliationAuthorizationVaultLimits = Readonly<{
  maximumRecords: number
  maximumStoredBytes: number
}>

export class ReconciliationAuthorizationVaultError extends Error {
  constructor(readonly code: 'configuration-invalid' | 'corrupted' | 'limit-exceeded') {
    super(`Reconciliation authorization vault ${code}`)
    this.name = 'ReconciliationAuthorizationVaultError'
  }
}

const prefix = 'gkg:transfer:reconciliation-authorization:v1:'
const encoder = new TextEncoder()
function key(receiptReference: string): string { return `${prefix}${receiptReference}` }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

/** Encrypted receipt-token vault. The storage record and key reveal only an opaque receipt UUID. */
export class WebExtensionReconciliationAuthorizationVault
implements OutboundReconciliationAuthorizationVault {
  private mutation: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: WebExtensionStorageArea,
    private readonly envelopes: AuthenticatedEnvelopeCodec,
    private readonly limits: ReconciliationAuthorizationVaultLimits,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      !Number.isInteger(limits.maximumRecords) || limits.maximumRecords < 1 ||
      !Number.isInteger(limits.maximumStoredBytes) || limits.maximumStoredBytes < 1_024
    ) throw new ReconciliationAuthorizationVaultError('configuration-invalid')
  }

  private async exclusively<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await work() } finally { release() }
  }

  private async decode(
    receiptReference: string,
    candidate: unknown,
  ): Promise<OutboundExecutionAuthorizationReceiptV2> {
    try {
      const receipt = outboundExecutionAuthorizationReceiptV2Schema.parse(
        await this.envelopes.open(
          key(receiptReference), 'reconciliation-authorization', candidate,
        ),
      )
      if (receipt.receiptReference !== receiptReference) {
        throw new ReconciliationAuthorizationVaultError('corrupted')
      }
      return receipt
    } catch (error) {
      if (
        error instanceof AuthenticatedEnvelopeError ||
        error instanceof ReconciliationAuthorizationVaultError
      ) throw new ReconciliationAuthorizationVaultError('corrupted')
      throw error
    }
  }

  async seal(
    authorization: OutboundExecutionAuthorizationReceiptV2,
  ): Promise<'sealed' | 'replayed' | 'conflict'> {
    return this.exclusively(async () => {
      const receipt = outboundExecutionAuthorizationReceiptV2Schema.parse(authorization)
      const storageKey = key(receipt.receiptReference)
      const existing = await readStoredValue(this.storage, storageKey)
      if (existing !== undefined) {
        return same(await this.decode(receipt.receiptReference, existing), receipt)
          ? 'replayed' : 'conflict'
      }
      if (Date.parse(receipt.reconciliationExpiresAt) <= this.now().getTime()) return 'conflict'
      const envelope = await this.envelopes.seal(
        storageKey, 'reconciliation-authorization', receipt,
      )
      const all = await this.storage.get(null)
      const records = Object.keys(all).filter((candidate) => candidate.startsWith(prefix))
      if (records.length >= this.limits.maximumRecords) {
        throw new ReconciliationAuthorizationVaultError('limit-exceeded')
      }
      let bytes = encoder.encode(JSON.stringify(envelope)).byteLength
      for (const [storedKey, value] of Object.entries(all)) {
        if (storedKey.startsWith(prefix)) bytes += encoder.encode(JSON.stringify(value)).byteLength
      }
      if (bytes > this.limits.maximumStoredBytes) {
        throw new ReconciliationAuthorizationVaultError('limit-exceeded')
      }
      await this.storage.set({ [storageKey]: envelope })
      return 'sealed'
    })
  }

  async load(receiptReference: string): Promise<OutboundExecutionAuthorizationReceiptV2 | null> {
    const reference = outboundExecutionAuthorizationReceiptV2Schema.shape.receiptReference
      .parse(receiptReference)
    const stored = await readStoredValue(this.storage, key(reference))
    if (stored === undefined) return null
    const receipt = await this.decode(reference, stored)
    if (Date.parse(receipt.reconciliationExpiresAt) <= this.now().getTime()) {
      await this.storage.remove(key(reference))
      return null
    }
    return receipt
  }

  async removeExpired(input: Readonly<{ now?: string; limit?: number }> = {}): Promise<number> {
    const instant = input.now === undefined ? this.now() : new Date(input.now)
    const limit = input.limit ?? 50
    if (!Number.isFinite(instant.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ReconciliationAuthorizationVaultError('configuration-invalid')
    }
    return this.exclusively(async () => {
      const all = await this.storage.get(null)
      const removable: string[] = []
      for (const [storageKey, value] of Object.entries(all)) {
        if (!storageKey.startsWith(prefix) || removable.length >= limit) continue
        const reference = storageKey.slice(prefix.length)
        const receipt = await this.decode(reference, value)
        if (Date.parse(receipt.reconciliationExpiresAt) <= instant.getTime()) {
          removable.push(storageKey)
        }
      }
      if (removable.length > 0) await this.storage.remove(removable)
      return removable.length
    })
  }
}

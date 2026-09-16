import { z } from 'zod'

import type {
  OutboundAttemptSeal,
  OutboundAttemptSpool,
  OutboundAttemptSpoolEntry,
} from '../../../../application/outbound-export/index.js'
import { AuthenticatedEnvelopeCodec, AuthenticatedEnvelopeError } from './authenticated-envelope.js'
import { readStoredValue, type WebExtensionStorageArea } from './storage-area.js'

const attemptSchema = z.object({
  schemaVersion: z.literal('outbound-attempt-seal.v1'),
  operationId: z.uuid(),
  receiptReference: z.uuid(),
  attemptId: z.uuid(),
  phase: z.enum(['create-target-list', 'add-items']),
  targetListId: z.string().min(1).max(512).nullable(),
  sequence: z.number().int().nonnegative().max(999),
  final: z.boolean(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  reconciliationReference: z.string().min(1).max(512),
  items: z.array(z.object({
    exportItemId: z.uuid(),
    providerPlaceId: z.string().min(1).max(512),
    position: z.number().int().nonnegative().optional(),
  }).strict()).max(500),
  sealedAt: z.iso.datetime({ offset: true }),
  writeExpiresAt: z.iso.datetime({ offset: true }),
  reconciliationExpiresAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((attempt, context) => {
  if (
    Date.parse(attempt.sealedAt) >= Date.parse(attempt.writeExpiresAt) ||
    Date.parse(attempt.writeExpiresAt) > Date.parse(attempt.reconciliationExpiresAt)
  ) context.addIssue({ code: 'custom', path: ['writeExpiresAt'], message: 'attempt expiry is invalid' })
  if (attempt.phase === 'create-target-list' && (attempt.targetListId !== null || attempt.items.length > 0)) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'create phase cannot contain items' })
  }
  if (attempt.phase === 'add-items' && (attempt.targetListId === null || attempt.items.length === 0)) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'add phase requires target and items' })
  }
})

const entrySchema = z.object({
  schemaVersion: z.literal('outbound-attempt-spool-entry.v1'),
  attempt: attemptSchema,
  state: z.enum(['sealed', 'prepared', 'reported', 'completed']),
  updatedAt: z.iso.datetime({ offset: true }),
  retainUntil: z.iso.datetime({ offset: true }).nullable(),
}).strict().superRefine((entry, context) => {
  if ((entry.state === 'completed') !== (entry.retainUntil !== null)) {
    context.addIssue({ code: 'custom', path: ['retainUntil'], message: 'retention state is invalid' })
  }
  if (Date.parse(entry.updatedAt) < Date.parse(entry.attempt.sealedAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'transition precedes seal' })
  }
})

type StoredEntry = z.infer<typeof entrySchema>

export type OutboundAttemptSpoolLimits = Readonly<{
  maximumRecords: number
  maximumStoredBytes: number
}>

export class OutboundAttemptStorageError extends Error {
  constructor(readonly code: 'configuration-invalid' | 'corrupted' | 'limit-exceeded') {
    super(`Outbound attempt storage ${code}`)
    this.name = 'OutboundAttemptStorageError'
  }
}

const prefix = 'gkg:transfer:outbound-attempt:v1:'
const encoder = new TextEncoder()
function key(attemptId: string): string { return `${prefix}${attemptId}` }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

function asPortEntry(entry: StoredEntry): OutboundAttemptSpoolEntry {
  return {
    attempt: {
      ...entry.attempt,
      items: entry.attempt.items.map((item) => item.position === undefined
        ? { exportItemId: item.exportItemId, providerPlaceId: item.providerPlaceId }
        : {
            exportItemId: item.exportItemId,
            providerPlaceId: item.providerPlaceId,
            position: item.position,
          }),
    },
    state: entry.state,
    updatedAt: entry.updatedAt,
    retainUntil: entry.retainUntil,
  }
}

/** One encrypted storage value per attempt makes every state transition a single-key replacement. */
export class WebExtensionOutboundAttemptSpool implements OutboundAttemptSpool {
  private mutation: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: WebExtensionStorageArea,
    private readonly envelopes: AuthenticatedEnvelopeCodec,
    private readonly limits: OutboundAttemptSpoolLimits,
  ) {
    if (
      !Number.isInteger(limits.maximumRecords) || limits.maximumRecords < 1 ||
      !Number.isInteger(limits.maximumStoredBytes) || limits.maximumStoredBytes < 1_024
    ) throw new OutboundAttemptStorageError('configuration-invalid')
  }

  private async exclusively<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await work() } finally { release() }
  }

  private async decode(attemptId: string, candidate: unknown): Promise<StoredEntry> {
    try {
      return entrySchema.parse(await this.envelopes.open(key(attemptId), 'outbound-attempt', candidate))
    } catch (error) {
      if (error instanceof AuthenticatedEnvelopeError || error instanceof z.ZodError) {
        throw new OutboundAttemptStorageError('corrupted')
      }
      throw error
    }
  }

  private async loadStored(attemptId: string): Promise<StoredEntry | null> {
    const parsedId = z.uuid().parse(attemptId)
    const value = await readStoredValue(this.storage, key(parsedId))
    if (value === undefined) return null
    const entry = await this.decode(parsedId, value)
    if (entry.attempt.attemptId !== parsedId) throw new OutboundAttemptStorageError('corrupted')
    return entry
  }

  private async store(entry: StoredEntry): Promise<void> {
    const storageKey = key(entry.attempt.attemptId)
    const envelope = await this.envelopes.seal(
      storageKey, 'outbound-attempt', entrySchema.parse(entry),
    )
    const all = await this.storage.get(null)
    const records = Object.keys(all).filter((candidate) => candidate.startsWith(prefix))
    if (!(storageKey in all) && records.length >= this.limits.maximumRecords) {
      throw new OutboundAttemptStorageError('limit-exceeded')
    }
    let bytes = encoder.encode(JSON.stringify(envelope)).byteLength
    for (const [storedKey, value] of Object.entries(all)) {
      if (storedKey.startsWith(prefix) && storedKey !== storageKey) {
        bytes += encoder.encode(JSON.stringify(value)).byteLength
      }
    }
    if (bytes > this.limits.maximumStoredBytes) {
      throw new OutboundAttemptStorageError('limit-exceeded')
    }
    await this.storage.set({ [storageKey]: envelope })
  }

  async seal(attempt: OutboundAttemptSeal): Promise<'sealed' | 'replayed' | 'conflict'> {
    return this.exclusively(async () => {
      const parsed = attemptSchema.parse(attempt)
      const existing = await this.loadStored(parsed.attemptId)
      if (existing !== null) return same(existing.attempt, parsed) ? 'replayed' : 'conflict'
      await this.store(entrySchema.parse({
        schemaVersion: 'outbound-attempt-spool-entry.v1', attempt: parsed,
        state: 'sealed', updatedAt: parsed.sealedAt, retainUntil: null,
      }))
      return 'sealed'
    })
  }

  async listPending(input: Readonly<{ limit: number }>): Promise<readonly OutboundAttemptSpoolEntry[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new OutboundAttemptStorageError('configuration-invalid')
    }
    const all = await this.storage.get(null)
    const entries: StoredEntry[] = []
    for (const [storageKey, value] of Object.entries(all)) {
      if (!storageKey.startsWith(prefix)) continue
      entries.push(await this.decode(storageKey.slice(prefix.length), value))
    }
    return entries.filter((entry) => entry.state !== 'completed')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, input.limit)
      .map(asPortEntry)
  }

  async load(attemptId: string): Promise<OutboundAttemptSpoolEntry | null> {
    const entry = await this.loadStored(attemptId)
    if (entry === null) return null
    return asPortEntry(entry)
  }

  private async transition(
    attemptId: string,
    from: StoredEntry['state'],
    to: StoredEntry['state'],
    at: string,
  ): Promise<'acknowledged' | 'replayed' | 'conflict' | 'not-found'> {
    return this.exclusively(async () => {
      const instant = new Date(at).toISOString()
      const entry = await this.loadStored(attemptId)
      if (entry === null) return 'not-found'
      if (entry.state === to) return entry.updatedAt === instant ? 'replayed' : 'conflict'
      if (entry.state !== from || Date.parse(instant) < Date.parse(entry.updatedAt)) return 'conflict'
      await this.store({ ...entry, state: to, updatedAt: instant })
      return 'acknowledged'
    })
  }

  acknowledgePrepared(input: Readonly<{ attemptId: string; preparedAt: string }>) {
    return this.transition(input.attemptId, 'sealed', 'prepared', input.preparedAt)
  }

  acknowledgeReported(input: Readonly<{ attemptId: string; reportedAt: string }>) {
    return this.transition(input.attemptId, 'prepared', 'reported', input.reportedAt)
  }

  async complete(input: Readonly<{
    attemptId: string
    completedAt: string
    retainUntil: string
  }>): Promise<'completed' | 'replayed' | 'conflict' | 'not-found'> {
    return this.exclusively(async () => {
      const completedAt = new Date(input.completedAt).toISOString()
      const retainUntil = new Date(input.retainUntil).toISOString()
      const entry = await this.loadStored(input.attemptId)
      if (entry === null) return 'not-found'
      if (entry.state === 'completed') {
        return entry.updatedAt === completedAt && entry.retainUntil === retainUntil
          ? 'replayed' : 'conflict'
      }
      if (
        entry.state !== 'reported' || Date.parse(completedAt) < Date.parse(entry.updatedAt) ||
        Date.parse(retainUntil) < Date.parse(entry.attempt.reconciliationExpiresAt) ||
        Date.parse(retainUntil) <= Date.parse(completedAt)
      ) return 'conflict'
      await this.store({ ...entry, state: 'completed', updatedAt: completedAt, retainUntil })
      return 'completed'
    })
  }

  async remove(input: Readonly<{
    attemptId: string
    now: string
  }>): Promise<'removed' | 'retained' | 'not-found'> {
    return this.exclusively(async () => {
      const now = new Date(input.now).toISOString()
      const entry = await this.loadStored(input.attemptId)
      if (entry === null) return 'not-found'
      if (
        entry.state !== 'completed' || entry.retainUntil === null ||
        Date.parse(now) < Date.parse(entry.retainUntil)
      ) return 'retained'
      await this.storage.remove(key(input.attemptId))
      return 'removed'
    })
  }

  async cleanupExpired(input: Readonly<{ now: string; limit?: number }>): Promise<number> {
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new OutboundAttemptStorageError('configuration-invalid')
    }
    const all = await this.storage.get(null)
    let removed = 0
    for (const storageKey of Object.keys(all).filter((candidate) => candidate.startsWith(prefix))) {
      if (removed >= limit) break
      const result = await this.remove({ attemptId: storageKey.slice(prefix.length), now: input.now })
      if (result === 'removed') removed += 1
    }
    return removed
  }
}

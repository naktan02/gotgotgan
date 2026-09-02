import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import type { Pool } from 'pg'

import type { BrowserAuthApplicationConfig } from './application-config.js'
import type {
  BrowserSession,
  BrowserSessionStore,
  OidcTransaction,
  OidcTransactionStore,
} from './oidc-bff.js'

type EncryptionKey = Readonly<{
  id: string
  value: Uint8Array
}>

type CryptoBytes = Uint8Array<ArrayBuffer>
type ByteSource = ArrayLike<number> & Readonly<{ byteLength: number }>

export type OidcStoreEncryption = Readonly<{
  activeKey: EncryptionKey
  decryptionKeys?: readonly EncryptionKey[]
}>

type EncryptedRow = Readonly<{
  id: string
  encryption_key_id: string
  initialization_vector: CryptoBytes
  authentication_tag: CryptoBytes
  ciphertext: CryptoBytes
  expires_at: Date
}>

type StoredKind = 'oidc-transaction' | 'browser-session'

const opaqueIdPattern = /^[A-Za-z0-9_-]{1,256}$/
const encryptionKeyIdPattern = /^[A-Za-z0-9._-]{1,128}$/

function copyBytes(value: ByteSource): CryptoBytes {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy
}

function concatenateBytes(parts: readonly ByteSource[]): CryptoBytes {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Stored browser authentication state is invalid')
  }
  return value
}

function optionalString(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Stored browser authentication state is invalid')
  }
  return value
}

function exactIsoTimestamp(value: string): string {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error('Stored browser authentication state is invalid')
  }
  return value
}

function parseTransaction(value: unknown): OidcTransaction {
  if (!isRecord(value)) throw new Error('Stored browser authentication state is invalid')
  return {
    id: requiredString(value, 'id'),
    state: requiredString(value, 'state'),
    nonce: requiredString(value, 'nonce'),
    pkceVerifier: requiredString(value, 'pkceVerifier'),
    expiresAt: exactIsoTimestamp(requiredString(value, 'expiresAt')),
  }
}

function parseSession(value: unknown): BrowserSession {
  if (!isRecord(value) || !isRecord(value.tokens)) {
    throw new Error('Stored browser authentication state is invalid')
  }
  const accessToken = requiredString(value.tokens, 'accessToken')
  const refreshToken = optionalString(value.tokens, 'refreshToken')
  return {
    id: requiredString(value, 'id'),
    tokens: {
      accessToken,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      expiresAt: exactIsoTimestamp(requiredString(value.tokens, 'expiresAt')),
    },
    expiresAt: exactIsoTimestamp(requiredString(value, 'expiresAt')),
  }
}

function assertOpaqueId(id: string): void {
  if (!opaqueIdPattern.test(id)) throw new Error('Browser authentication identifier is invalid')
}

export class PostgresOidcStore implements OidcTransactionStore, BrowserSessionStore {
  readonly #pool: Pool
  readonly #storageNamespace: string
  readonly #activeKeyId: string
  readonly #keys: ReadonlyMap<string, CryptoBytes>

  constructor(
    pool: Pool,
    encryption: OidcStoreEncryption,
    application: BrowserAuthApplicationConfig,
  ) {
    const keys = new Map<string, CryptoBytes>()
    for (const key of [encryption.activeKey, ...(encryption.decryptionKeys ?? [])]) {
      if (!encryptionKeyIdPattern.test(key.id) || key.value.byteLength !== 32) {
        throw new Error('OIDC store encryption configuration is invalid')
      }
      const value = copyBytes(key.value)
      const existing = keys.get(key.id)
      if (existing !== undefined && !timingSafeEqual(existing, value)) {
        throw new Error('OIDC store encryption configuration is invalid')
      }
      keys.set(key.id, value)
    }
    this.#pool = pool
    this.#storageNamespace = application.storageNamespace
    this.#activeKeyId = encryption.activeKey.id
    this.#keys = keys
  }

  create(value: OidcTransaction): Promise<void>
  create(value: BrowserSession): Promise<void>
  async create(value: OidcTransaction | BrowserSession): Promise<void> {
    assertOpaqueId(value.id)
    const kind = 'tokens' in value ? 'browser-session' : 'oidc-transaction'
    const table = kind === 'browser-session' ? 'sessions' : 'oidc_transactions'
    const encrypted = this.#encrypt(kind, value.id, value.expiresAt, value)
    await this.#pool.query(
      `
        INSERT INTO browser_auth.${table} (
          id,
          encryption_key_id,
          initialization_vector,
          authentication_tag,
          ciphertext,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        value.id,
        encrypted.keyId,
        encrypted.initializationVector,
        encrypted.authenticationTag,
        encrypted.ciphertext,
        value.expiresAt,
      ],
    )
  }

  async take(id: string): Promise<OidcTransaction | undefined> {
    if (!opaqueIdPattern.test(id)) return undefined
    const result = await this.#pool.query<EncryptedRow>(
      `
        DELETE FROM browser_auth.oidc_transactions
        WHERE id = $1
        RETURNING
          id,
          encryption_key_id,
          initialization_vector,
          authentication_tag,
          ciphertext,
          expires_at
      `,
      [id],
    )
    const row = result.rows[0]
    if (row === undefined) return undefined
    return parseTransaction(this.#decrypt('oidc-transaction', row))
  }

  async find(id: string): Promise<BrowserSession | undefined> {
    if (!opaqueIdPattern.test(id)) return undefined
    const result = await this.#pool.query<EncryptedRow>(
      `
        SELECT
          id,
          encryption_key_id,
          initialization_vector,
          authentication_tag,
          ciphertext,
          expires_at
        FROM browser_auth.sessions
        WHERE id = $1
      `,
      [id],
    )
    const row = result.rows[0]
    if (row === undefined) return undefined
    return parseSession(this.#decrypt('browser-session', row))
  }

  async delete(id: string): Promise<void> {
    if (!opaqueIdPattern.test(id)) return
    await this.#pool.query('DELETE FROM browser_auth.sessions WHERE id = $1', [id])
  }

  async cleanupExpired(
    now: Date,
    batchSize: number,
  ): Promise<Readonly<{ transactionsDeleted: number; sessionsDeleted: number }>> {
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isInteger(batchSize) ||
      batchSize <= 0 ||
      batchSize > 1_000
    ) {
      throw new Error('OIDC store cleanup configuration is invalid')
    }
    const transactionsDeleted = await this.#deleteExpired(
      'oidc_transactions',
      now,
      batchSize,
    )
    const sessionsDeleted = await this.#deleteExpired('sessions', now, batchSize)
    return { transactionsDeleted, sessionsDeleted }
  }

  async #deleteExpired(
    table: 'oidc_transactions' | 'sessions',
    now: Date,
    batchSize: number,
  ): Promise<number> {
    const result = await this.#pool.query(
      `
        WITH expired AS (
          SELECT id
          FROM browser_auth.${table}
          WHERE expires_at <= $1
          ORDER BY expires_at, id
          LIMIT $2
        )
        DELETE FROM browser_auth.${table} records
        USING expired
        WHERE records.id = expired.id
      `,
      [now.toISOString(), batchSize],
    )
    return result.rowCount ?? 0
  }

  #encrypt(kind: StoredKind, id: string, expiresAt: string, value: unknown) {
    exactIsoTimestamp(expiresAt)
    const initializationVector = copyBytes(randomBytes(12))
    const key = this.#keys.get(this.#activeKeyId)
    if (key === undefined) throw new Error('OIDC store encryption configuration is invalid')
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector)
    cipher.setAAD(this.#additionalAuthenticatedData(kind, id, expiresAt, this.#activeKeyId))
    const ciphertext = concatenateBytes([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ])
    return {
      keyId: this.#activeKeyId,
      initializationVector,
      authenticationTag: copyBytes(cipher.getAuthTag()),
      ciphertext,
    }
  }

  #decrypt(kind: StoredKind, row: EncryptedRow): unknown {
    const expiresAt = row.expires_at.toISOString()
    const key = this.#keys.get(row.encryption_key_id)
    if (key === undefined) throw new Error('Stored browser authentication state is invalid')
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        row.initialization_vector,
      )
      decipher.setAAD(
        this.#additionalAuthenticatedData(kind, row.id, expiresAt, row.encryption_key_id),
      )
      decipher.setAuthTag(row.authentication_tag)
      const plaintext = concatenateBytes([
        decipher.update(row.ciphertext),
        decipher.final(),
      ])
      return JSON.parse(new TextDecoder().decode(plaintext))
    } catch {
      throw new Error('Stored browser authentication state is invalid')
    }
  }

  #additionalAuthenticatedData(
    kind: StoredKind,
    id: string,
    expiresAt: string,
    keyId: string,
  ): CryptoBytes {
    return copyBytes(
      new TextEncoder().encode(
        `${this.#storageNamespace}\u0000${kind}\u0000${id}\u0000${expiresAt}\u0000${keyId}`,
      ),
    )
  }
}

import { z } from 'zod'

const base64UrlSchema = z.string().min(1).max(16_777_216).regex(/^[A-Za-z0-9_-]+$/)
const envelopeSchema = z.object({
  schemaVersion: z.literal('connector-authenticated-envelope.v1'),
  algorithm: z.literal('AES-GCM'),
  keyReference: z.string().min(1).max(120),
  purpose: z.enum([
    'snapshot-index', 'snapshot-chunk', 'outbound-attempt', 'reconciliation-authorization',
  ]),
  iv: base64UrlSchema,
  ciphertext: base64UrlSchema,
  createdAt: z.iso.datetime({ offset: true }),
}).strict()

export type AuthenticatedEnvelopePurpose = z.infer<typeof envelopeSchema>['purpose']
export type AuthenticatedEnvelope = z.infer<typeof envelopeSchema>

export class AuthenticatedEnvelopeError extends Error {
  constructor(readonly code: 'configuration-invalid' | 'corrupted' | 'limit-exceeded') {
    super(`Authenticated transfer storage ${code}`)
    this.name = 'AuthenticatedEnvelopeError'
  }
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function additionalData(storageKey: string, purpose: AuthenticatedEnvelopePurpose): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: 'connector-authenticated-envelope.v1', storageKey, purpose,
  }))
}

function assertNonExtractableAesKey(key: CryptoKey): void {
  if (
    key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
    !key.usages.includes('encrypt') || !key.usages.includes('decrypt')
  ) throw new AuthenticatedEnvelopeError('configuration-invalid')
}

/**
 * Versioned AEAD codec. It accepts only an externally provisioned non-extractable key and never
 * serializes key material. Production composition must prove how that key survives a restart.
 */
export class AuthenticatedEnvelopeCodec {
  private readonly encoder = new TextEncoder()
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(
    private readonly key: CryptoKey,
    private readonly keyReference: string,
    private readonly maximumPlaintextBytes: number,
    private readonly cryptography: Crypto = globalThis.crypto,
    private readonly now: () => Date = () => new Date(),
  ) {
    assertNonExtractableAesKey(key)
    if (
      !/^[A-Za-z0-9._~-]{1,120}$/u.test(keyReference) ||
      !Number.isInteger(maximumPlaintextBytes) || maximumPlaintextBytes < 1
    ) throw new AuthenticatedEnvelopeError('configuration-invalid')
  }

  async seal(
    storageKey: string,
    purpose: AuthenticatedEnvelopePurpose,
    value: unknown,
  ): Promise<AuthenticatedEnvelope> {
    const plaintext = this.encoder.encode(JSON.stringify(value))
    if (plaintext.byteLength > this.maximumPlaintextBytes) {
      throw new AuthenticatedEnvelopeError('limit-exceeded')
    }
    const iv = this.cryptography.getRandomValues(new Uint8Array(12))
    const ciphertext = await this.cryptography.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: additionalData(storageKey, purpose), tagLength: 128,
    }, this.key, plaintext)
    return envelopeSchema.parse({
      schemaVersion: 'connector-authenticated-envelope.v1',
      algorithm: 'AES-GCM',
      keyReference: this.keyReference,
      purpose,
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
      createdAt: this.now().toISOString(),
    })
  }

  async open<T>(
    storageKey: string,
    purpose: AuthenticatedEnvelopePurpose,
    candidate: unknown,
  ): Promise<T> {
    const envelope = envelopeSchema.safeParse(candidate)
    if (
      !envelope.success || envelope.data.keyReference !== this.keyReference ||
      envelope.data.purpose !== purpose
    ) throw new AuthenticatedEnvelopeError('corrupted')
    try {
      const plaintext = await this.cryptography.subtle.decrypt({
        name: 'AES-GCM',
        iv: base64UrlToBytes(envelope.data.iv),
        additionalData: additionalData(storageKey, purpose),
        tagLength: 128,
      }, this.key, base64UrlToBytes(envelope.data.ciphertext))
      if (plaintext.byteLength > this.maximumPlaintextBytes) {
        throw new AuthenticatedEnvelopeError('limit-exceeded')
      }
      return JSON.parse(this.decoder.decode(plaintext)) as T
    } catch (error) {
      if (error instanceof AuthenticatedEnvelopeError) throw error
      throw new AuthenticatedEnvelopeError('corrupted')
    }
  }
}

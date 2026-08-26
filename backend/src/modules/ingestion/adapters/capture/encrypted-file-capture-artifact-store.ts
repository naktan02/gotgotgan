import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { z } from 'zod'

import type { CaptureArtifactReplayStore } from '../../application/ports/capture-artifact-store.js'

const referencePattern = /^capture:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const artifactIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const envelopeSchema = z.object({
  schemaVersion: z.literal('place-capture-envelope.v1'),
  algorithm: z.literal('A256GCM'),
  keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  batchId: z.string().uuid(),
  providerKey: z.enum(['naver', 'kakao', 'google']),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  retentionUntil: z.iso.datetime({ offset: true }),
  nonce: z.string().min(16).max(24),
  ciphertext: z.string().min(1),
  tag: z.string().min(16).max(32),
}).strict()

type Envelope = z.infer<typeof envelopeSchema>

function aad(envelope: Pick<
  Envelope,
  'schemaVersion' | 'algorithm' | 'keyId' | 'batchId' | 'providerKey' | 'checksum' | 'retentionUntil'
>): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: envelope.schemaVersion,
    algorithm: envelope.algorithm,
    keyId: envelope.keyId,
    batchId: envelope.batchId,
    providerKey: envelope.providerKey,
    checksum: envelope.checksum,
    retentionUntil: envelope.retentionUntil,
  }), 'utf8')
}

function artifactError(): Error {
  return new Error('Capture artifact is invalid')
}

export class EncryptedFileCaptureArtifactStore implements CaptureArtifactReplayStore {
  private readonly keys: ReadonlyMap<string, Buffer>

  constructor(private readonly config: Readonly<{
    root: string
    activeKeyId: string
    keys: Readonly<Record<string, Uint8Array>>
    maximumBytes: number
    now: () => Date
  }>) {
    if (
      !isAbsolute(config.root) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(config.activeKeyId) ||
      !Number.isInteger(config.maximumBytes) ||
      config.maximumBytes <= 0
    ) throw artifactError()
    const entries = Object.entries(config.keys)
    if (entries.length === 0) throw artifactError()
    this.keys = new Map(entries.map(([keyId, key]) => {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || key.byteLength !== 32) throw artifactError()
      return [keyId, Buffer.from(key)]
    }))
    if (!this.keys.has(config.activeKeyId)) throw artifactError()
  }

  async put(input: Parameters<CaptureArtifactReplayStore['put']>[0]) {
    if (
      !artifactIdPattern.test(input.artifactId) ||
      input.body.byteLength > this.config.maximumBytes ||
      createHash('sha256').update(input.body).digest('hex') !== input.checksum ||
      Number.isNaN(Date.parse(input.retentionUntil)) ||
      new Date(input.retentionUntil).getTime() <= this.config.now().getTime()
    ) throw artifactError()
    await mkdir(this.config.root, { recursive: true, mode: 0o700 })
    const reference = `capture:${input.artifactId}`
    const target = this.path(input.artifactId)
    const nonce = randomBytes(12)
    const header = {
      schemaVersion: 'place-capture-envelope.v1' as const,
      algorithm: 'A256GCM' as const,
      keyId: this.config.activeKeyId,
      batchId: input.batchId,
      providerKey: input.providerKey,
      checksum: input.checksum,
      retentionUntil: input.retentionUntil,
    }
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(header.keyId)!, nonce)
    cipher.setAAD(aad(header))
    const ciphertext = Buffer.concat([cipher.update(input.body), cipher.final()])
    const envelope: Envelope = {
      ...header,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    }
    try {
      await writeFile(target, `${JSON.stringify(envelope)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }
      const prior = await this.get({
        reference,
        batchId: input.batchId,
        providerKey: input.providerKey,
      })
      if (prior === undefined || createHash('sha256').update(prior).digest('hex') !== input.checksum) {
        throw artifactError()
      }
    }
    return { reference, checksum: input.checksum }
  }

  async get(input: Parameters<CaptureArtifactReplayStore['get']>[0]): Promise<Uint8Array | undefined> {
    const matched = referencePattern.exec(input.reference)
    if (matched === null) return undefined
    let decoded: unknown
    try {
      decoded = JSON.parse(await readFile(this.path(matched[1]!), 'utf8'))
    } catch {
      return undefined
    }
    const parsed = envelopeSchema.safeParse(decoded)
    if (!parsed.success) throw artifactError()
    const envelope = parsed.data
    if (
      envelope.batchId !== input.batchId ||
      envelope.providerKey !== input.providerKey ||
      new Date(envelope.retentionUntil).getTime() <= this.config.now().getTime()
    ) return undefined
    const key = this.keys.get(envelope.keyId)
    if (key === undefined) throw artifactError()
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'),
      )
      decipher.setAAD(aad(envelope))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
      const body = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ])
      if (createHash('sha256').update(body).digest('hex') !== envelope.checksum) throw artifactError()
      return new Uint8Array(body)
    } catch {
      throw artifactError()
    }
  }

  private path(artifactId: string): string {
    return join(this.config.root, `${artifactId}.capture`)
  }
}

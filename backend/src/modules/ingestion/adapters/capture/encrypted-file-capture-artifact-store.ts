import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

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

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
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

  reference(artifactId: string): string {
    if (!artifactIdPattern.test(artifactId)) throw artifactError()
    return `capture:${artifactId}`
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
    const reference = this.reference(input.artifactId)
    const target = this.boundPath(
      input.artifactId, input.batchId, input.providerKey, this.config.activeKeyId,
    )
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
    for (const candidate of [...this.boundPaths(
      input.artifactId, input.batchId, input.providerKey,
    ), this.legacyPath(input.artifactId)]) {
      const prior = await this.readEnvelope(candidate)
      if (prior.kind === 'missing' || prior.kind === 'invalid') continue
      const body = this.decrypt(prior.envelope, input)
      if (body === undefined || createHash('sha256').update(body).digest('hex') !== input.checksum) {
        throw artifactError()
      }
      return { reference, checksum: input.checksum }
    }
    await this.publish(target, `${JSON.stringify(envelope)}\n`, input)
    return { reference, checksum: input.checksum }
  }

  async get(input: Parameters<CaptureArtifactReplayStore['get']>[0]): Promise<Uint8Array | undefined> {
    const matched = referencePattern.exec(input.reference)
    if (matched === null) return undefined
    for (const candidate of [...this.boundPaths(
      matched[1]!, input.batchId, input.providerKey,
    ), this.legacyPath(matched[1]!)]) {
      const stored = await this.readEnvelope(candidate)
      if (stored.kind === 'missing') continue
      if (stored.kind === 'invalid') throw artifactError()
      return this.decrypt(stored.envelope, input)
    }
    return undefined
  }

  async delete(input: Parameters<CaptureArtifactReplayStore['delete']>[0]): Promise<'deleted' | 'missing'> {
    return this.remove(input, true)
  }

  /** Deletes a bound artifact after its consumer has durably completed or cancelled it. */
  async discard(input: Parameters<CaptureArtifactReplayStore['delete']>[0]): Promise<'deleted' | 'missing'> {
    return this.remove(input, false)
  }

  private async remove(
    input: Parameters<CaptureArtifactReplayStore['delete']>[0],
    requireExpiry: boolean,
  ): Promise<'deleted' | 'missing'> {
    const matched = referencePattern.exec(input.reference)
    if (matched === null) return 'missing'
    let deleted = false
    for (const candidate of this.boundPaths(matched[1]!, input.batchId, input.providerKey)) {
      const stored = await this.readEnvelope(candidate)
      if (stored.kind === 'missing') continue
      if (stored.kind === 'envelope') {
        if (stored.envelope.batchId !== input.batchId ||
          stored.envelope.providerKey !== input.providerKey) throw artifactError()
        if (requireExpiry &&
          new Date(stored.envelope.retentionUntil).getTime() > this.config.now().getTime()) {
          throw new Error('Capture artifact is not expired')
        }
      }
      deleted = await this.unlink(candidate) || deleted
    }
    const legacy = await this.readEnvelope(this.legacyPath(matched[1]!))
    if (legacy.kind === 'envelope') {
      if (legacy.envelope.batchId !== input.batchId ||
        legacy.envelope.providerKey !== input.providerKey) throw artifactError()
      if (requireExpiry &&
        new Date(legacy.envelope.retentionUntil).getTime() > this.config.now().getTime()) {
        throw new Error('Capture artifact is not expired')
      }
      deleted = await this.unlink(this.legacyPath(matched[1]!)) || deleted
    } else if (legacy.kind === 'invalid') {
      throw artifactError()
    }
    deleted = await this.removeTemporaryFiles(
      matched[1]!, input.batchId, input.providerKey,
    ) || deleted
    return deleted ? 'deleted' : 'missing'
  }

  private legacyPath(artifactId: string): string {
    return join(this.config.root, `${artifactId}.capture`)
  }

  private bindingToken(
    artifactId: string,
    batchId: string,
    providerKey: 'naver' | 'kakao' | 'google',
    keyId: string,
  ): string {
    const key = this.keys.get(keyId)!
    const bindingKey = createHash('sha256')
      .update('place-capture-path-binding.v1\0').update(key).digest()
    return createHmac('sha256', bindingKey)
      .update(`${artifactId}\0${batchId}\0${providerKey}`, 'utf8').digest('hex').slice(0, 32)
  }

  private boundPath(
    artifactId: string,
    batchId: string,
    providerKey: 'naver' | 'kakao' | 'google',
    keyId: string,
  ): string {
    return join(this.config.root, `${artifactId}.${this.bindingToken(
      artifactId, batchId, providerKey, keyId,
    )}.capture`)
  }

  private boundPaths(
    artifactId: string,
    batchId: string,
    providerKey: 'naver' | 'kakao' | 'google',
  ): readonly string[] {
    const keyIds = [this.config.activeKeyId, ...this.keys.keys()]
    return [...new Set(keyIds)].map((keyId) =>
      this.boundPath(artifactId, batchId, providerKey, keyId))
  }

  private async readEnvelope(path: string): Promise<
    | Readonly<{ kind: 'missing' }>
    | Readonly<{ kind: 'invalid' }>
    | Readonly<{ kind: 'envelope'; envelope: Envelope }>
  > {
    let decoded: unknown
    try {
      decoded = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      return hasCode(error, 'ENOENT') ? { kind: 'missing' } : { kind: 'invalid' }
    }
    const parsed = envelopeSchema.safeParse(decoded)
    return parsed.success ? { kind: 'envelope', envelope: parsed.data } : { kind: 'invalid' }
  }

  private decrypt(
    envelope: Envelope,
    input: Readonly<{
      batchId: string
      providerKey: 'naver' | 'kakao' | 'google'
    }>,
  ): Uint8Array | undefined {
    if (envelope.batchId !== input.batchId || envelope.providerKey !== input.providerKey ||
      new Date(envelope.retentionUntil).getTime() <= this.config.now().getTime()) return undefined
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
      if (createHash('sha256').update(body).digest('hex') !== envelope.checksum) {
        throw artifactError()
      }
      return new Uint8Array(body)
    } catch {
      throw artifactError()
    }
  }

  private async publish(
    target: string,
    body: string,
    input: Parameters<CaptureArtifactReplayStore['put']>[0],
  ): Promise<void> {
    const temporary = join(this.config.root, `.${basename(target)}.${randomBytes(8).toString('hex')}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(body, { encoding: 'utf8' })
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      try {
        await link(temporary, target)
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        const stored = await this.readEnvelope(target)
        if (stored.kind === 'invalid') {
          await rename(temporary, target)
          return
        }
        if (stored.kind === 'missing') throw error
        const prior = this.decrypt(stored.envelope, input)
        if (prior === undefined ||
          createHash('sha256').update(prior).digest('hex') !== input.checksum) {
          throw artifactError()
        }
      }
    } finally {
      await this.unlink(temporary)
    }
  }

  private async removeTemporaryFiles(
    artifactId: string,
    batchId: string,
    providerKey: 'naver' | 'kakao' | 'google',
  ): Promise<boolean> {
    let names: readonly string[]
    try {
      names = await readdir(this.config.root)
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false
      throw error
    }
    const prefixes = this.boundPaths(artifactId, batchId, providerKey)
      .map((path) => `.${basename(path)}.`)
    let deleted = false
    for (const name of names) {
      if (!name.endsWith('.tmp') || !prefixes.some((prefix) => name.startsWith(prefix))) continue
      deleted = await this.unlink(join(this.config.root, name)) || deleted
    }
    return deleted
  }

  private async unlink(path: string): Promise<boolean> {
    try {
      await unlink(path)
      return true
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false
      throw error
    }
  }
}

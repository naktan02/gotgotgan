import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { z } from 'zod'

const keyIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const keyringSchema = z.object({
  schemaVersion: z.literal('place-capture-keyring.v1'),
  activeKeyId: keyIdSchema,
  keys: z.array(z.object({
    id: keyIdSchema,
    material: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }).strict()).min(1).max(32),
}).strict()

export type CaptureArtifactConfig = Readonly<{
  root: string
  activeKeyId: string
  keys: Readonly<Record<string, Uint8Array>>
  maximumBytes: number
}>

export async function loadCaptureArtifactConfig(input: Readonly<{
  root: string
  keyringFile: string
  maximumBytes: number
}>): Promise<CaptureArtifactConfig> {
  if (
    !isAbsolute(input.root) || !Number.isInteger(input.maximumBytes) ||
    input.maximumBytes <= 0 || input.maximumBytes > 104_857_600
  ) throw new Error('Capture artifact configuration is invalid')
  try {
    const keyring = keyringSchema.parse(
      JSON.parse(await readFile(input.keyringFile, 'utf8')) as unknown,
    )
    if (new Set(keyring.keys.map((key) => key.id)).size !== keyring.keys.length) {
      throw new Error('duplicate key')
    }
    const keys = Object.fromEntries(keyring.keys.map((key) => {
      const material = Buffer.from(key.material, 'base64url')
      if (material.byteLength !== 32 || material.toString('base64url') !== key.material) {
        throw new Error('invalid key')
      }
      return [key.id, new Uint8Array(material)]
    }))
    if (keys[keyring.activeKeyId] === undefined) throw new Error('missing active key')
    return { root: input.root, activeKeyId: keyring.activeKeyId, keys, maximumBytes: input.maximumBytes }
  } catch {
    throw new Error('Capture artifact configuration is invalid')
  }
}

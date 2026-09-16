import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { EncryptedFileCaptureArtifactStore } from '../index.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('encrypted capture artifact store', () => {
  it('writes no plaintext and replays only inside the expected batch/provider boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'place-captures-'))
    directories.push(root)
    const body = new TextEncoder().encode('{"kind":"page","name":"private fixture"}')
    const store = new EncryptedFileCaptureArtifactStore({
      root,
      activeKeyId: 'key-2026-08',
      keys: { 'key-2026-08': new Uint8Array(32).fill(7) },
      maximumBytes: 1_000_000,
      now: () => new Date('2026-08-26T11:00:00.000Z'),
    })
    const artifactId = '01992d20-b000-7000-8000-000000000001'
    const stored = await store.put({
      artifactId,
      batchId: '01992d20-b000-7000-8000-000000000002',
      providerKey: 'naver',
      body,
      checksum: createHash('sha256').update(body).digest('hex'),
      contentType: 'application/json',
      retentionUntil: '2026-08-27T11:00:00.000Z',
    })
    const capture = (await readdir(root)).find((name) => name.endsWith('.capture'))!
    const raw = await readFile(join(root, capture), 'utf8')
    expect(raw).not.toContain('private fixture')
    expect(await store.get({
      reference: stored.reference,
      batchId: '01992d20-b000-7000-8000-000000000002',
      providerKey: 'naver',
    })).toEqual(body)
    expect(await store.get({
      reference: stored.reference,
      batchId: '01992d20-b000-7000-8000-000000000099',
      providerKey: 'naver',
    })).toBeUndefined()
  })

  it('rejects checksum drift and expired reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'place-captures-'))
    directories.push(root)
    await mkdir(root, { recursive: true })
    const body = new TextEncoder().encode('{}')
    let now = new Date('2026-08-26T11:00:00.000Z')
    const store = new EncryptedFileCaptureArtifactStore({
      root,
      activeKeyId: 'active',
      keys: { active: new Uint8Array(32).fill(9) },
      maximumBytes: 100,
      now: () => now,
    })
    await expect(store.put({
      artifactId: '01992d20-b000-7000-8000-000000000010',
      batchId: '01992d20-b000-7000-8000-000000000011',
      providerKey: 'naver', body, checksum: '0'.repeat(64),
      contentType: 'application/json', retentionUntil: '2026-08-27T11:00:00.000Z',
    })).rejects.toThrow('invalid')

    const checksum = createHash('sha256').update(body).digest('hex')
    const stored = await store.put({
      artifactId: '01992d20-b000-7000-8000-000000000012',
      batchId: '01992d20-b000-7000-8000-000000000011',
      providerKey: 'naver', body, checksum,
      contentType: 'application/json', retentionUntil: '2026-08-27T11:00:00.000Z',
    })
    now = new Date('2026-08-28T11:00:00.000Z')
    expect(await store.get({
      reference: stored.reference,
      batchId: '01992d20-b000-7000-8000-000000000011',
      providerKey: 'naver',
    })).toBeUndefined()
  })

  it('deletes only expired artifacts inside the expected batch and provider boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'place-captures-'))
    directories.push(root)
    const body = new TextEncoder().encode('{}')
    let now = new Date('2026-08-26T11:00:00.000Z')
    const store = new EncryptedFileCaptureArtifactStore({
      root, activeKeyId: 'active', keys: { active: new Uint8Array(32).fill(5) },
      maximumBytes: 100, now: () => now,
    })
    const artifactId = '01992d20-b000-7000-8000-000000000020'
    const batchId = '01992d20-b000-7000-8000-000000000021'
    const stored = await store.put({
      artifactId, batchId, providerKey: 'naver', body,
      checksum: createHash('sha256').update(body).digest('hex'),
      contentType: 'application/json', retentionUntil: '2026-08-27T11:00:00.000Z',
    })
    const capture = (await readdir(root)).find((name) => name.endsWith('.capture'))!

    await expect(store.delete({
      reference: stored.reference, batchId, providerKey: 'naver',
    })).rejects.toThrow('not expired')
    now = new Date('2026-08-28T11:00:00.000Z')
    await expect(store.delete({
      reference: stored.reference, batchId: '01992d20-b000-7000-8000-000000000099',
      providerKey: 'naver',
    })).resolves.toBe('missing')
    await expect(store.delete({
      reference: stored.reference, batchId, providerKey: 'naver',
    })).resolves.toBe('deleted')
    await expect(access(join(root, capture))).rejects.toThrow()
    await expect(store.delete({
      reference: stored.reference, batchId, providerKey: 'naver',
    })).resolves.toBe('missing')
  })

  it('recovers a partial published file and deletes malformed data only through its binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'place-captures-'))
    directories.push(root)
    const body = new TextEncoder().encode('{"kind":"page"}')
    const artifactId = '01992d20-b000-7000-8000-000000000030'
    const batchId = '01992d20-b000-7000-8000-000000000031'
    const store = new EncryptedFileCaptureArtifactStore({
      root, activeKeyId: 'active', keys: { active: new Uint8Array(32).fill(6) },
      maximumBytes: 100, now: () => new Date('2026-08-26T11:00:00.000Z'),
    })
    const input = {
      artifactId, batchId, providerKey: 'naver' as const, body,
      checksum: createHash('sha256').update(body).digest('hex'),
      contentType: 'application/json' as const,
      retentionUntil: '2026-08-27T11:00:00.000Z',
    }
    const stored = await store.put(input)
    const capture = (await readdir(root)).find((name) => name.endsWith('.capture'))!
    await writeFile(join(root, capture), '{"partial"', 'utf8')

    await expect(store.put(input)).resolves.toEqual(stored)
    expect(await store.get({ reference: stored.reference, batchId, providerKey: 'naver' }))
      .toEqual(body)

    await writeFile(join(root, capture), '{"partial"', 'utf8')
    await expect(store.discard({
      reference: stored.reference,
      batchId: '01992d20-b000-7000-8000-000000000099',
      providerKey: 'naver',
    })).resolves.toBe('missing')
    await expect(access(join(root, capture))).resolves.toBeUndefined()
    await expect(store.discard({
      reference: stored.reference, batchId, providerKey: 'naver',
    })).resolves.toBe('deleted')
    await expect(access(join(root, capture))).rejects.toThrow()
  })
})

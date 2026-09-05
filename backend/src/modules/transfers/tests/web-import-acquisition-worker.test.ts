import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createWebImportAcquisitionWorker } from '../application/web-import-acquisition-worker.js'
import { WebImportAcquisitions } from '../application/web-import-acquisitions.js'
import type {
  WebImportAcquisitionClaim,
  WebImportAcquisitionStore,
  WebImportArtifactStore,
} from '../application/ports/web-import-acquisition.js'

const ids = Array.from({ length: 12 }, (_, index) => (
  `01995010-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
))
const at = '2026-09-05T03:00:00.000Z'
const command = {
  schemaVersion: 'start-import-acquisition.v1' as const,
  kind: 'shared-links' as const,
  commandId: ids[0]!, acquisitionId: ids[1]!, importSourceId: ids[2]!, snapshotId: ids[3]!,
  providerKey: 'naver' as const,
  links: [{ entryId: ids[4]!, position: 0, url: 'https://naver.me/TestLink1' }],
}

const processing = {
  schemaVersion: 'import-acquisition.v1' as const,
  acquisitionId: command.acquisitionId,
  acquisitionRevision: '1',
  importSourceId: command.importSourceId,
  providerKey: 'naver' as const,
  method: 'shared-links' as const,
  state: 'processing' as const,
  items: [{ entryId: command.links[0]!.entryId, position: 0, state: 'pending' as const }],
  progress: { total: 1, processed: 0, ready: 0, failed: 0 },
  createdAt: at,
  updatedAt: at,
}

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function store(overrides: Partial<WebImportAcquisitionStore> = {}): WebImportAcquisitionStore {
  return {
    reserve: vi.fn(async (input) => input.artifact === undefined
      ? { status: 'complete' as const, result: {
          schemaVersion: 'import-acquisition-command-result.v1' as const,
          outcome: 'accepted' as const, commandId: command.commandId,
          status: 'applied' as const, acquisition: processing,
        } }
      : { status: 'reserved' as const, artifact: input.artifact }),
    activate: vi.fn(async () => ({
      result: {
        schemaVersion: 'import-acquisition-command-result.v1' as const,
        outcome: 'accepted' as const, commandId: command.commandId,
        status: 'applied' as const, acquisition: processing,
      },
      artifactRequired: true,
    })),
    get: vi.fn(async () => undefined),
    cancel: vi.fn(async () => ({ result: {
      schemaVersion: 'import-acquisition-command-result.v1' as const,
      outcome: 'rejected' as const, commandId: ids[5]!,
      rejection: { code: 'not-found' as const },
    } })),
    claim: vi.fn(async () => undefined),
    recordInspectionSnapshot: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    expire: vi.fn(async () => undefined),
    pendingArtifactCleanup: vi.fn(async () => []),
    markArtifactDeleted: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('web import acquisition queue module', () => {
  it('rejects a lease shorter than the provider batch deadline plus safety margin', () => {
    expect(() => createWebImportAcquisitionWorker({
      workerId: 'worker', leaseMilliseconds: 149_999, store: store(),
      artifacts: {} as WebImportArtifactStore,
      source: { providerKey: 'naver', inspect: vi.fn() },
      now: () => new Date(at),
    })).toThrow('lease is invalid')
  })

  it('keeps remote browser acquisition disabled before persistence by default', async () => {
    const persistence = store()
    const acquisitions = new WebImportAcquisitions({
      store: persistence,
      artifacts: {} as WebImportArtifactStore,
      artifactRetentionMilliseconds: 900_000,
      now: () => new Date(at),
    })

    await expect(acquisitions.start(ids[7]!, {
      schemaVersion: 'start-import-acquisition.v1', kind: 'remote-browser',
      commandId: command.commandId, acquisitionId: command.acquisitionId,
      importSourceId: command.importSourceId, providerKey: 'naver',
    })).rejects.toThrow('remote browser acquisition is disabled')
    expect(persistence.reserve).not.toHaveBeenCalled()
  })

  it('stores raw links only in the encrypted artifact and returns the queued projection', async () => {
    let stagedBody: Uint8Array | undefined
    const persistence = store()
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(async (input) => {
        stagedBody = input.body
        return { reference: `capture:${ids[6]}`, checksum: input.checksum }
      }),
      get: vi.fn(async () => undefined),
      discard: vi.fn(async () => 'deleted' as const),
    }
    const acquisitions = new WebImportAcquisitions({
      store: persistence,
      artifacts,
      artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[6]!,
      now: () => new Date(at),
    })

    await expect(acquisitions.start(ids[7]!, command)).resolves.toMatchObject({
      outcome: 'accepted', status: 'applied', acquisition: { state: 'processing' },
    })
    expect(new TextDecoder().decode(stagedBody)).toContain(command.links[0]!.url)
    const persistedInput = vi.mocked(persistence.reserve).mock.calls[0]![0]
    expect(JSON.stringify(persistedInput)).not.toContain(command.links[0]!.url)
    expect(persistedInput.artifact?.retainedUntil).toBe('2026-09-05T03:15:00.000Z')
  })

  it('keeps the reserved artifact when activation has an ambiguous failure', async () => {
    const persistence = store()
    vi.mocked(persistence.reserve)
      .mockResolvedValueOnce({ status: 'reserved', artifact: {
        artifactId: ids[6]!, reference: `capture:${ids[6]}`,
        checksum: digest(JSON.stringify(command)),
        retainedUntil: '2026-09-05T03:15:00.000Z',
      } })
      .mockResolvedValueOnce({ status: 'complete', result: {
        schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
        commandId: command.commandId, status: 'replayed', acquisition: processing,
      } })
    vi.mocked(persistence.activate).mockRejectedValueOnce(new Error('ambiguous commit'))
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(async (input) => ({
        reference: `capture:${input.artifactId}`, checksum: input.checksum,
      })),
      get: vi.fn(),
      discard: vi.fn(async () => 'deleted' as const),
    }
    const acquisitions = new WebImportAcquisitions({
      store: persistence, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[6]!, now: () => new Date(at),
    })

    await expect(acquisitions.start(ids[7]!, command)).rejects.toThrow('ambiguous commit')
    expect(artifacts.discard).not.toHaveBeenCalled()
    await expect(acquisitions.start(ids[7]!, command)).resolves.toMatchObject({
      outcome: 'accepted', status: 'replayed',
    })
    expect(artifacts.put).toHaveBeenCalledOnce()
  })

  it('does not discard a shared reserved artifact when its put attempt fails', async () => {
    const persistence = store()
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(async () => { throw new Error('write failed') }),
      get: vi.fn(),
      discard: vi.fn(async () => 'deleted' as const),
    }
    const acquisitions = new WebImportAcquisitions({
      store: persistence, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[6]!, now: () => new Date(at),
    })

    await expect(acquisitions.start(ids[7]!, command)).rejects.toThrow('write failed')
    expect(artifacts.discard).not.toHaveBeenCalled()
    expect(persistence.activate).not.toHaveBeenCalled()
  })

  it('removes a delayed concurrent replay artifact after the job already completed', async () => {
    const present = new Set<string>()
    let putCalls = 0
    let releaseFirstPut!: () => void
    let markFirstPutStarted!: () => void
    const firstPutStarted = new Promise<void>((resolve) => { markFirstPutStarted = resolve })
    const firstPutGate = new Promise<void>((resolve) => { releaseFirstPut = resolve })
    let terminal = false
    const persistence = store({
      activate: vi.fn(async () => ({
        result: {
          schemaVersion: 'import-acquisition-command-result.v1' as const,
          outcome: 'accepted' as const,
          commandId: command.commandId,
          status: terminal ? 'replayed' as const : 'applied' as const,
          acquisition: processing,
        },
        artifactRequired: !terminal,
      })),
    })
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(async (input) => {
        putCalls += 1
        if (putCalls === 1) {
          markFirstPutStarted()
          await firstPutGate
        }
        present.add(`capture:${input.artifactId}`)
        return { reference: `capture:${input.artifactId}`, checksum: input.checksum }
      }),
      get: vi.fn(),
      discard: vi.fn(async ({ reference }) => present.delete(reference) ? 'deleted' : 'missing'),
    }
    const acquisitions = new WebImportAcquisitions({
      store: persistence, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[6]!, now: () => new Date(at),
    })

    const delayed = acquisitions.start(ids[7]!, command)
    await firstPutStarted
    await expect(acquisitions.start(ids[7]!, command)).resolves.toMatchObject({
      outcome: 'accepted', status: 'applied',
    })
    present.clear()
    terminal = true
    releaseFirstPut()
    await expect(delayed).resolves.toMatchObject({ outcome: 'accepted', status: 'replayed' })

    expect(present.size).toBe(0)
    expect(artifacts.discard).toHaveBeenCalledOnce()
    expect(persistence.markArtifactDeleted).toHaveBeenCalledOnce()
  })

  it('reclaims an expired lease with deterministic snapshot input and cleans the artifact once', async () => {
    const body = new TextEncoder().encode(JSON.stringify(command))
    const claim: WebImportAcquisitionClaim = {
      acquisitionId: command.acquisitionId,
      ownerMemberId: ids[7]!,
      importSourceId: command.importSourceId,
      providerKey: 'naver', snapshotId: command.snapshotId,
      artifact: {
        artifactId: ids[6]!,
        reference: `capture:${ids[6]}`, checksum: digest(body),
        retainedUntil: '2026-09-05T03:15:00.000Z',
      },
      observedAt: at,
      lease: { owner: 'worker', generation: 1, expiresAt: '2026-09-05T03:10:00.000Z' },
    }
    let complete = false
    let stagedResults: WebImportAcquisitionClaim['inspectionResults']
    const snapshotInputs: unknown[] = []
    const persistence = store({
      claim: vi.fn()
        .mockResolvedValueOnce(claim)
        .mockImplementationOnce(async () => ({
          ...claim,
          inspectionResults: stagedResults,
          lease: { ...claim.lease, generation: 2 },
        })),
      recordInspectionSnapshot: vi.fn(async (input) => {
        stagedResults = input.results
        snapshotInputs.push(input.snapshot)
      }),
      complete: vi.fn()
        .mockRejectedValueOnce(new Error('lease lost after snapshot'))
        .mockImplementationOnce(async () => { complete = true }),
      pendingArtifactCleanup: vi.fn(async () => complete ? [{
        acquisitionId: claim.acquisitionId,
        providerKey: 'naver' as const,
        reference: claim.artifact.reference,
      }] : []),
    })
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(),
      get: vi.fn(async () => body),
      discard: vi.fn(async () => 'deleted' as const),
    }
    const source = { providerKey: 'naver' as const, inspect: vi.fn(async () => [{
      entryId: command.links[0]!.entryId, position: 0, status: 'succeeded' as const,
      inputUrlDigest: digest(command.links[0]!.url), shareId: 'share-1',
      list: {
        sourceListId: 'share-1', observedName: '서울', sourcePosition: 0,
        items: [{
          sourceItemId: 'bookmark-1', providerPlaceId: 'place-1', observedName: '카페',
          observedAddress: null, observedCategory: null, observedLocation: null,
          sourcePosition: 0,
        }],
      },
    }]) }
    const worker = createWebImportAcquisitionWorker({
      workerId: 'worker', leaseMilliseconds: 600_000,
      store: persistence, artifacts, source,
      now: () => new Date(at),
    })

    await expect(worker.runOne()).resolves.toMatchObject({ status: 'deferred' })
    await expect(worker.runOne()).resolves.toMatchObject({ status: 'processed' })
    expect(persistence.recordInspectionSnapshot).toHaveBeenCalledTimes(2)
    expect(snapshotInputs[0]).toEqual(snapshotInputs[1])
    expect(source.inspect).toHaveBeenCalledOnce()
    expect(artifacts.discard).toHaveBeenCalledOnce()
    expect(persistence.markArtifactDeleted).toHaveBeenCalledOnce()
  })

  it('expires and cleans a decryptable artifact whose JSON is invalid', async () => {
    const body = new TextEncoder().encode('{invalid')
    const claim: WebImportAcquisitionClaim = {
      acquisitionId: command.acquisitionId, ownerMemberId: ids[7]!,
      importSourceId: command.importSourceId, providerKey: 'naver', snapshotId: command.snapshotId,
      artifact: {
        artifactId: ids[6]!,
        reference: `capture:${ids[6]}`, checksum: digest(body),
        retainedUntil: '2026-09-05T03:15:00.000Z',
      },
      observedAt: at,
      lease: { owner: 'worker', generation: 1, expiresAt: '2026-09-05T03:10:00.000Z' },
    }
    let expired = false
    const persistence = store({
      claim: vi.fn(async () => claim),
      expire: vi.fn(async () => { expired = true }),
      pendingArtifactCleanup: vi.fn(async () => expired ? [{
        acquisitionId: claim.acquisitionId, providerKey: 'naver' as const,
        reference: claim.artifact.reference,
      }] : []),
    })
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(), get: vi.fn(async () => body),
      discard: vi.fn(async () => 'deleted' as const),
    }
    const source = { providerKey: 'naver' as const, inspect: vi.fn() }
    const worker = createWebImportAcquisitionWorker({
      workerId: 'worker', leaseMilliseconds: 600_000,
      store: persistence, artifacts, source,
      now: () => new Date(at),
    })

    await expect(worker.runOne()).resolves.toMatchObject({ status: 'expired' })
    expect(persistence.expire).toHaveBeenCalledOnce()
    expect(artifacts.discard).toHaveBeenCalledOnce()
    expect(source.inspect).not.toHaveBeenCalled()
    expect(persistence.recordInspectionSnapshot).not.toHaveBeenCalled()
  })

  it('aborts provider work and deletes the artifact at its absolute retention deadline', async () => {
    const body = new TextEncoder().encode(JSON.stringify(command))
    const claim: WebImportAcquisitionClaim = {
      acquisitionId: command.acquisitionId, ownerMemberId: ids[7]!,
      importSourceId: command.importSourceId, providerKey: 'naver', snapshotId: command.snapshotId,
      artifact: {
        artifactId: ids[6]!, reference: `capture:${ids[6]}`, checksum: digest(body),
        retainedUntil: '2026-09-05T03:00:00.010Z',
      },
      observedAt: at,
      lease: { owner: 'worker', generation: 1, expiresAt: '2026-09-05T03:10:00.000Z' },
    }
    let expired = false
    const persistence = store({
      claim: vi.fn(async () => claim),
      expire: vi.fn(async () => { expired = true }),
      pendingArtifactCleanup: vi.fn(async () => expired ? [{
        acquisitionId: claim.acquisitionId, providerKey: 'naver' as const,
        reference: claim.artifact.reference,
      }] : []),
    })
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(), get: vi.fn(async () => body),
      discard: vi.fn(async () => 'deleted' as const),
    }
    const source = {
      providerKey: 'naver' as const,
      inspect: vi.fn(async ({ signal }: { signal: AbortSignal }) => new Promise<never>(
        (_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))),
      )),
    }
    const worker = createWebImportAcquisitionWorker({
      workerId: 'worker', leaseMilliseconds: 600_000,
      store: persistence, artifacts, source,
      now: () => new Date(at),
    })

    await expect(worker.runOne()).resolves.toMatchObject({ status: 'expired' })
    expect(source.inspect).toHaveBeenCalledOnce()
    expect(artifacts.discard).toHaveBeenCalled()
    expect(persistence.expire).toHaveBeenCalledOnce()
  })

  it('finishes from a fenced inspection checkpoint after raw-link retention expires', async () => {
    const body = new TextEncoder().encode(JSON.stringify(command))
    const results = [{
      entryId: command.links[0]!.entryId, position: 0, status: 'succeeded' as const,
      inputUrlDigest: digest(command.links[0]!.url), shareId: 'share-1',
      list: {
        sourceListId: 'share-1', observedName: '고정 결과', sourcePosition: 0,
        items: [{
          sourceItemId: 'bookmark-1', providerPlaceId: 'place-1', observedName: '장소',
          observedAddress: null, observedCategory: null, observedLocation: null,
          sourcePosition: 0,
        }],
      },
    }]
    const claim: WebImportAcquisitionClaim = {
      acquisitionId: command.acquisitionId, ownerMemberId: ids[7]!,
      importSourceId: command.importSourceId, providerKey: 'naver', snapshotId: command.snapshotId,
      artifact: {
        artifactId: ids[6]!, reference: `capture:${ids[6]}`, checksum: digest(body),
        retainedUntil: '2026-09-05T03:00:00.000Z',
      },
      inspectionResults: results,
      observedAt: at,
      lease: { owner: 'worker', generation: 2, expiresAt: '2026-09-05T03:10:00.000Z' },
    }
    let complete = false
    const persistence = store({
      claim: vi.fn(async () => claim),
      complete: vi.fn(async () => { complete = true }),
      pendingArtifactCleanup: vi.fn(async () => complete ? [{
        acquisitionId: claim.acquisitionId, providerKey: 'naver' as const,
        reference: claim.artifact.reference,
      }] : []),
    })
    const artifacts: WebImportArtifactStore = {
      reference: (artifactId) => `capture:${artifactId}`,
      put: vi.fn(), get: vi.fn(), discard: vi.fn(async () => 'missing' as const),
    }
    const source = { providerKey: 'naver' as const, inspect: vi.fn() }
    const worker = createWebImportAcquisitionWorker({
      workerId: 'worker', leaseMilliseconds: 600_000,
      store: persistence, artifacts, source, now: () => new Date(at),
    })

    await expect(worker.runOne()).resolves.toMatchObject({ status: 'processed' })
    expect(source.inspect).not.toHaveBeenCalled()
    expect(artifacts.get).not.toHaveBeenCalled()
    expect(persistence.recordInspectionSnapshot).toHaveBeenCalledOnce()
    expect(persistence.complete).toHaveBeenCalledOnce()
    expect(persistence.expire).not.toHaveBeenCalled()
  })
})

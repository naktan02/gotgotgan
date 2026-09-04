import type {
  ConnectorCaptureChunkV2,
  ConnectorCaptureManifestV2,
  ConnectorImportGrantRequestV2,
  ConnectorImportGrantV2,
} from '@place/contracts/transfers'
import { describe, expect, it, vi } from 'vitest'

import { collectAndHandoffImmutableSnapshot } from '../import-snapshot/index.js'
import type {
  ConnectorSnapshotHandoff,
  ConnectorSnapshotIdentity,
  ConnectorSnapshotSpool,
} from '../import-snapshot/index.js'
import type { SavedPlaceSource } from '../ports/saved-place-source.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'
const installationId = '33333333-3333-4333-8333-333333333333'
const manifestId = '44444444-4444-4444-8444-444444444444'
const snapshotId = '55555555-5555-4555-8555-555555555555'
const accountFingerprint = 'a'.repeat(64)
const now = new Date('2026-09-03T00:00:00.000Z')
const identity: ConnectorSnapshotIdentity = {
  operationId, connectionId, providerKey: 'naver', accountFingerprint,
  installationId, manifestId,
}

function memorySpool() {
  const chunks = new Map<number, ConnectorCaptureChunkV2>()
  let manifest: ConnectorCaptureManifestV2 | undefined
  const spool: ConnectorSnapshotSpool = {
    open: async ({ observedAt, capturedAt }) => manifest === undefined
      ? { state: 'collecting', observedAt, capturedAt }
      : { state: 'sealed', manifest },
    stage: async ({ chunk }) => {
      const existing = chunks.get(chunk.sequence)
      if (existing === undefined) {
        chunks.set(chunk.sequence, chunk)
        return 'recorded'
      }
      return JSON.stringify(existing) === JSON.stringify(chunk) ? 'replayed' : 'conflict'
    },
    seal: async ({ manifest: candidate }) => {
      if (manifest === undefined) {
        manifest = candidate
        return 'sealed'
      }
      return JSON.stringify(manifest) === JSON.stringify(candidate) ? 'replayed' : 'conflict'
    },
    async *read({ fromSequence }) {
      for (let sequence = fromSequence; sequence < chunks.size; sequence += 1) {
        yield chunks.get(sequence)!
      }
    },
  }
  return { spool, chunks, manifest: () => manifest }
}

function grant(request: ConnectorImportGrantRequestV2): ConnectorImportGrantV2 {
  return {
    schemaVersion: 'connector-import-grant.v2',
    grantId: crypto.randomUUID(),
    operationId: request.operationId,
    connectionId: request.connectionId,
    providerKey: request.providerKey,
    accountFingerprint: request.accountFingerprint,
    installationId: request.installationId,
    operation: 'import-saved-library',
    token: 'opaque.connector.grant.token.that.is.long.enough',
    placeOrigin: request.placeOrigin,
    manifest: request.manifest,
    issuedAt: now.toISOString(),
    expiresAt: '2026-09-03T00:05:00.000Z',
    limits: {
      maximumChunks: 10, maximumItems: 100, maximumBytes: 100_000,
      maximumChunkBytes: 10_000,
    },
  }
}

function dependencies(input: Readonly<{
  spool: ConnectorSnapshotSpool
  handoff: ConnectorSnapshotHandoff
  collect?: SavedPlaceSource['collect']
  fingerprint?: string
}>) {
  const collect = input.collect ?? (async function* () {
    yield { acquisitionKind: 'browser-network' as const, itemCount: 1, payload: JSON.stringify({
      lists: [{ sourceListId: 'list-a', observedName: '여행', sourcePosition: 0,
        items: [{ sourceItemId: 'item-a', providerPlaceId: 'place-a',
          observedName: '라멘 🍜', observedAddress: null, observedCategory: '라멘',
          observedLocation: null, sourcePosition: 0 }] }],
    }) }
    yield { acquisitionKind: 'browser-network' as const, itemCount: 1, payload: JSON.stringify({
      lists: [{ sourceListId: 'list-b', observedName: '카페', sourcePosition: 1,
        items: [{ sourceItemId: 'item-b', providerPlaceId: null,
          observedName: '카페', observedAddress: null, observedCategory: null,
          observedLocation: null, sourcePosition: 0 }] }],
    }) }
  })
  return {
    session: { providerKey: 'naver' as const, probe: async () => 'active' as const },
    accountFingerprint: {
      providerKey: 'naver' as const,
      read: async () => input.fingerprint ?? accountFingerprint,
    },
    source: { providerKey: 'naver' as const, collect },
    normalizer: {
      providerKey: 'naver' as const,
      parserVersion: 'test-normalizer.v1',
      normalize: (capture: { payload: string }) => JSON.parse(capture.payload) as never,
    },
    spool: input.spool,
    handoff: input.handoff,
    limits: {
      maximumChunks: 10, maximumItems: 100, maximumBytes: 100_000,
      maximumChunkBytes: 10_000,
    },
    now: () => now,
  }
}

function attempt(commandId: string) {
  return {
    identity,
    grantAttempt: {
      commandId, expectedConnectionRevision: 'connection-r1',
      placeOrigin: 'https://place.example',
    },
    signal: new AbortController().signal,
  }
}

describe('immutable Connector snapshot handoff', () => {
  it('seals once, reissues a grant with a new command, and resumes an uploaded prefix', async () => {
    const local = memorySpool()
    const recorded = new Map<number, ConnectorCaptureChunkV2>()
    let failAfterFirstChunk = true
    const issuedCommands: string[] = []
    const handoff: ConnectorSnapshotHandoff = {
      issueGrant: async ({ request }) => {
        issuedCommands.push(request.commandId)
        return {
          schemaVersion: 'connector-import-grant-result.v2', outcome: 'accepted',
          commandId: request.commandId, status: 'applied', grant: grant(request),
        }
      },
      status: async ({ grant: value }) => ({
        schemaVersion: 'connector-capture-manifest-status.v2',
        operationId, manifestId, state: 'receiving',
        recordedSequences: [...recorded.keys()], nextSequence: recorded.size,
        snapshotId: null, snapshotVersion: null,
      }),
      upload: async ({ chunk }) => {
        if (chunk.sequence === 1 && failAfterFirstChunk) throw new Error('grant expired in transit')
        recorded.set(chunk.sequence, chunk)
        return {
          schemaVersion: 'connector-capture-chunk-receipt.v2', outcome: 'recorded',
          operationId, manifestId, acceptedSequence: chunk.sequence,
          nextSequence: recorded.size, receivedChunks: recorded.size,
          receivedItems: [...recorded.values()].reduce((sum, item) => sum + item.itemCount, 0),
          receivedBytes: [...recorded.values()].reduce((sum, item) => sum + item.byteCount, 0),
        }
      },
      complete: async () => ({
        schemaVersion: 'connector-capture-complete-result.v2', outcome: 'completed',
        operationId, manifestId, missingSequences: [], snapshotId, snapshotVersion: 'snapshot-r1',
      }),
    }
    let collectionCalls = 0
    const baseCollect = dependencies({ spool: local.spool, handoff }).source.collect
    const collect: SavedPlaceSource['collect'] = async function* (input) {
      collectionCalls += 1
      yield* baseCollect(input)
    }
    const deps = dependencies({ spool: local.spool, handoff, collect })
    const firstCommand = '66666666-6666-4666-8666-666666666666'
    const secondCommand = '77777777-7777-4777-8777-777777777777'

    await expect(collectAndHandoffImmutableSnapshot(deps, attempt(firstCommand)))
      .rejects.toThrow('grant expired in transit')
    expect(recorded.size).toBe(1)
    failAfterFirstChunk = false
    await expect(collectAndHandoffImmutableSnapshot(deps, attempt(secondCommand))).resolves.toMatchObject({
      status: 'completed', snapshotId, snapshotVersion: 'snapshot-r1',
    })

    expect(collectionCalls).toBe(1)
    expect(issuedCommands).toEqual([firstCommand, secondCommand])
    expect(recorded.size).toBe(2)
    expect(local.manifest()?.manifestDigest).toMatch(/^[a-f0-9]{64}$/)
    for (const chunk of local.chunks.values()) {
      expect(chunk.byteCount).toBe(new TextEncoder().encode(chunk.payload).byteLength)
      expect(chunk.checksum).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('does not report an incomplete server manifest as completed', async () => {
    const local = memorySpool()
    const handoff: ConnectorSnapshotHandoff = {
      issueGrant: async ({ request }) => ({
        schemaVersion: 'connector-import-grant-result.v2', outcome: 'accepted',
        commandId: request.commandId, status: 'applied', grant: grant(request),
      }),
      status: async () => ({
        schemaVersion: 'connector-capture-manifest-status.v2', operationId, manifestId,
        state: 'receiving', recordedSequences: [], nextSequence: 0,
        snapshotId: null, snapshotVersion: null,
      }),
      upload: async ({ chunk }) => ({
        schemaVersion: 'connector-capture-chunk-receipt.v2', outcome: 'recorded',
        operationId, manifestId, acceptedSequence: chunk.sequence,
        nextSequence: chunk.sequence + 1, receivedChunks: chunk.sequence + 1,
        receivedItems: chunk.sequence + 1, receivedBytes: [...local.chunks.values()]
          .slice(0, chunk.sequence + 1).reduce((sum, item) => sum + item.byteCount, 0),
      }),
      complete: async () => ({
        schemaVersion: 'connector-capture-complete-result.v2', outcome: 'incomplete',
        operationId, manifestId, missingSequences: [1], snapshotId: null, snapshotVersion: null,
      }),
    }
    await expect(collectAndHandoffImmutableSnapshot(
      dependencies({ spool: local.spool, handoff }),
      attempt('88888888-8888-4888-8888-888888888888'),
    )).resolves.toMatchObject({ status: 'incomplete', missingSequences: [1] })
  })

  it('rejects mixed acquisition strategies inside one immutable snapshot', async () => {
    const local = memorySpool()
    const collect: SavedPlaceSource['collect'] = async function* () {
      yield { acquisitionKind: 'browser-network', itemCount: 0, payload: '{"lists":[]}' }
      yield { acquisitionKind: 'browser-dom', itemCount: 0, payload: '{"lists":[]}' }
    }
    const handoff = {
      issueGrant: vi.fn(), status: vi.fn(), upload: vi.fn(), complete: vi.fn(),
    }

    await expect(collectAndHandoffImmutableSnapshot(
      dependencies({ spool: local.spool, handoff, collect }),
      attempt('89898989-8989-4989-8989-898989898989'),
    )).rejects.toMatchObject({ code: 'capture-invalid' })
    expect(handoff.issueGrant).not.toHaveBeenCalled()
  })

  it('rejects a switched account before collecting or staging private payloads', async () => {
    const local = memorySpool()
    const issueGrant = vi.fn()
    let collectionCalls = 0
    const collect: SavedPlaceSource['collect'] = async function* () {
      collectionCalls += 1
      yield { acquisitionKind: 'browser-network', itemCount: 0, payload: '{"lists":[]}' }
    }
    await expect(collectAndHandoffImmutableSnapshot(
      dependencies({
        spool: local.spool,
        handoff: { issueGrant, status: vi.fn(), upload: vi.fn(), complete: vi.fn() },
        collect,
        fingerprint: 'b'.repeat(64),
      }),
      attempt('99999999-9999-4999-8999-999999999999'),
    )).rejects.toMatchObject({ code: 'binding-mismatch' })
    expect(collectionCalls).toBe(0)
    expect(issueGrant).not.toHaveBeenCalled()
    expect(local.chunks.size).toBe(0)
  })

  it('rejects a grant for another connection or account before upload', async () => {
    const local = memorySpool()
    const status = vi.fn()
    const handoff: ConnectorSnapshotHandoff = {
      issueGrant: async ({ request }) => ({
        schemaVersion: 'connector-import-grant-result.v2', outcome: 'accepted',
        commandId: request.commandId, status: 'applied',
        grant: { ...grant(request), accountFingerprint: 'b'.repeat(64) },
      }),
      status,
      upload: vi.fn(),
      complete: vi.fn(),
    }
    await expect(collectAndHandoffImmutableSnapshot(
      dependencies({ spool: local.spool, handoff }),
      attempt('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    )).rejects.toMatchObject({ code: 'binding-mismatch' })
    expect(status).not.toHaveBeenCalled()
  })

  it('stops before the next protected handoff call when a grant expires in transit', async () => {
    const local = memorySpool()
    let clock = new Date('2026-09-03T00:00:00.000Z')
    const upload = vi.fn()
    const handoff: ConnectorSnapshotHandoff = {
      issueGrant: async ({ request }) => ({
        schemaVersion: 'connector-import-grant-result.v2', outcome: 'accepted',
        commandId: request.commandId, status: 'applied', grant: grant(request),
      }),
      status: async () => {
        clock = new Date('2026-09-03T00:05:00.000Z')
        return {
          schemaVersion: 'connector-capture-manifest-status.v2' as const,
          operationId, manifestId, state: 'receiving' as const,
          recordedSequences: [], nextSequence: 0,
          snapshotId: null, snapshotVersion: null,
        }
      },
      upload,
      complete: vi.fn(),
    }
    const deps = {
      ...dependencies({ spool: local.spool, handoff }),
      now: () => clock,
    }

    await expect(collectAndHandoffImmutableSnapshot(
      deps,
      attempt('abababab-abab-4bab-8bab-abababababab'),
    )).rejects.toMatchObject({ code: 'grant-expired', retryable: true })
    expect(upload).not.toHaveBeenCalled()
  })
})

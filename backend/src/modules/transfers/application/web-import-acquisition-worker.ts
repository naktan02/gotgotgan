import { createHash } from 'node:crypto'

import { startImportAcquisitionV1Schema } from '@place/contracts/transfers'

import { transferFingerprint } from './identity.js'
import type {
  WebImportAcquisitionStore,
  WebImportArtifactStore,
} from './ports/web-import-acquisition.js'
import type {
  SharedLinkImportSource,
  SharedLinkInspectionResult,
} from '../domain/acquisitions.js'

type Options = Readonly<{
  workerId: string
  leaseMilliseconds: number
  store: WebImportAcquisitionStore
  artifacts: WebImportArtifactStore
  source: SharedLinkImportSource
  now?: () => Date
}>

function checksum(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

export function createWebImportAcquisitionWorker(options: Options) {
  if (!Number.isInteger(options.leaseMilliseconds) ||
    options.leaseMilliseconds < 150_000 || options.leaseMilliseconds > 840_000) {
    throw new Error('web import acquisition lease is invalid')
  }
  const now = options.now ?? (() => new Date())

  async function cleanup(limit = 10): Promise<number> {
    const pending = await options.store.pendingArtifactCleanup(limit)
    let completed = 0
    for (const artifact of pending) {
      try {
        await options.artifacts.discard({
          reference: artifact.reference,
          batchId: artifact.acquisitionId,
          providerKey: artifact.providerKey,
        })
        await options.store.markArtifactDeleted(artifact.acquisitionId, now().toISOString())
        completed += 1
      } catch {
        // Encrypted input remains bounded by its retention time and is retried on the next pass.
      }
    }
    return completed
  }

  async function runOne(signal = new AbortController().signal) {
    await cleanup()
    const claimedAt = now()
    const claim = await options.store.claim({
      workerId: options.workerId,
      claimedAt: claimedAt.toISOString(),
      leaseUntil: new Date(claimedAt.getTime() + options.leaseMilliseconds).toISOString(),
    })
    if (claim === undefined) return { status: 'idle' as const }

    const artifactBinding = {
      reference: claim.artifact.reference,
      batchId: claim.acquisitionId,
      providerKey: claim.providerKey,
    } as const
    const remainingMilliseconds = Date.parse(claim.artifact.retainedUntil) - claimedAt.getTime()
    let deadlineReached = remainingMilliseconds <= 0
    let deadlineDeletion: Promise<unknown> = deadlineReached
      ? options.artifacts.discard(artifactBinding).catch(() => undefined)
      : Promise.resolve()
    const deadlineController = new AbortController()
    const deleteAtDeadline = () => {
      deadlineReached = true
      deadlineController.abort()
      deadlineDeletion = options.artifacts.discard(artifactBinding).catch(() => undefined)
    }
    const deadlineTimer = deadlineReached
      ? undefined
      : setTimeout(deleteAtDeadline, remainingMilliseconds)
    deadlineTimer?.unref()

    const expireClaim = async () => {
      if (deadlineReached) await deadlineDeletion
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
      await options.store.expire({ claim, expiredAt: now().toISOString() })
      await cleanup()
      return { status: 'expired' as const, acquisitionId: claim.acquisitionId }
    }
    if (deadlineReached && claim.inspectionResults === undefined) return expireClaim()
    if (deadlineReached) await deadlineDeletion

    let results = claim.inspectionResults
    let checkpointed = results !== undefined
    try {
      if (results === undefined) {
        let body: Uint8Array | undefined
        try {
          body = await options.artifacts.get(artifactBinding)
        } catch {
          return expireClaim()
        }
        if (body === undefined || checksum(body) !== claim.artifact.checksum) {
          return expireClaim()
        }
        let decoded: unknown
        try {
          decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
        } catch {
          return expireClaim()
        }
        const parsed = startImportAcquisitionV1Schema.safeParse(decoded)
        if (!parsed.success || parsed.data.kind !== 'shared-links' ||
          parsed.data.acquisitionId !== claim.acquisitionId ||
          parsed.data.importSourceId !== claim.importSourceId ||
          parsed.data.snapshotId !== claim.snapshotId ||
          parsed.data.providerKey !== claim.providerKey) {
          return expireClaim()
        }
        results = await options.source.inspect({
          entries: parsed.data.links,
          signal: AbortSignal.any([signal, deadlineController.signal]),
        })
      }
      if (deadlineReached && !checkpointed) return expireClaim()
      const succeeded = results.filter((result) => result.status === 'succeeded')
      const lists = succeeded.map((result) => ({
        ...result.list,
        items: result.list.items.map((item) => ({
          ...item,
          match: { status: 'unresolved' as const, reason: 'missing-identity' as const },
        })),
      }))
      const snapshot = succeeded.length === 0 ? undefined : {
          snapshotId: claim.snapshotId,
          ownerMemberId: claim.ownerMemberId,
          providerKey: claim.providerKey,
          source: {
            kind: 'one-shot',
            importSourceId: claim.importSourceId,
            acquisitionMethod: 'shared-link',
            authorizationBasis: 'link-possession',
            accountAssurance: 'unverified',
          },
          sourceRevision: transferFingerprint({ providerKey: claim.providerKey, lists }),
          provenance: { acquisitionKind: 'structured-web', parserVersion: 'naver-shared-list.v1' },
          observedAt: claim.observedAt,
          capturedAt: claim.observedAt,
          lists,
        } as const
      await options.store.recordInspectionSnapshot({
        claim,
        results,
        ...(snapshot === undefined ? {} : { snapshot }),
        recordedAt: now().toISOString(),
      })
      checkpointed = true
      if (deadlineReached) await deadlineDeletion
      await options.store.complete({ claim, results, completedAt: now().toISOString() })
    } catch {
      if (deadlineReached && !checkpointed) return expireClaim()
      return { status: 'deferred' as const, acquisitionId: claim.acquisitionId }
    }

    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
    await cleanup()
    return { status: 'processed' as const, acquisitionId: claim.acquisitionId }
  }

  return { runOne, cleanup }
}

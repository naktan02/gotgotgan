import type { CaptureArtifactStore } from './ports/capture-artifact-store.js'
import type { ConnectedPlaceSource } from './ports/connected-place-source.js'
import type {
  ImportClaim,
  ImportWorkerStore,
  PreparedImportItem,
} from './ports/import-worker-store.js'
import { ImportLeaseLostError } from '../domain/imports.js'
import { prepareImportedPlaceItem } from './prepare-imported-place-item.js'

export function createImportWorker(dependencies: Readonly<{
  workerId: string
  store: ImportWorkerStore
  captureStore: CaptureArtifactStore
  sources: readonly ConnectedPlaceSource[]
  nextId: () => string
  now: () => Date
  leaseMilliseconds: number
  captureRetentionMilliseconds: number
  maximumAttempts: number
  retryDelayMilliseconds: (attemptCount: number) => number
}>) {
  const sources = new Map(dependencies.sources.map((source) => [source.providerKey, source]))
  if (sources.size !== dependencies.sources.length) {
    throw new Error('Import source keys must be unique.')
  }
  if (
    dependencies.workerId.length === 0 ||
    !Number.isInteger(dependencies.leaseMilliseconds) ||
    dependencies.leaseMilliseconds <= 0 ||
    !Number.isInteger(dependencies.captureRetentionMilliseconds) ||
    dependencies.captureRetentionMilliseconds <= 0 ||
    !Number.isInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts <= 0
  ) throw new Error('Import worker configuration is invalid.')

  async function finishFailure(
    claim: ImportClaim,
    code: 'provider-unavailable' | 'capture-invalid',
    retryable: boolean,
    at: string,
  ) {
    const mayRetry = retryable && claim.attemptCount < dependencies.maximumAttempts
    const retryAt = mayRetry
      ? new Date(new Date(at).getTime() + dependencies.retryDelayMilliseconds(claim.attemptCount)).toISOString()
      : undefined
    await dependencies.store.finishAttempt({
      claim,
      outcome: {
        kind: 'failure',
        code,
        retryable: mayRetry,
        ...(retryAt === undefined ? {} : { retryAt }),
      },
      finishedAt: at,
    })
    return {
      status: mayRetry ? 'retry-scheduled' as const : 'failed' as const,
      batchId: claim.batchId,
      code,
    }
  }

  return {
    async runOne() {
      const started = dependencies.now()
      const startedAt = started.toISOString()
      const leaseUntil = new Date(
        started.getTime() + dependencies.leaseMilliseconds,
      ).toISOString()
      const claim = await dependencies.store.claimNext({
        workerId: dependencies.workerId,
        claimedAt: startedAt,
        leaseUntil,
      })
      if (claim === undefined) return { status: 'idle' as const }
      if (claim.cancellationRequestedAt !== null) {
        await dependencies.store.finishAttempt({
          claim,
          outcome: { kind: 'cancelled' },
          finishedAt: startedAt,
        })
        return { status: 'cancelled' as const, batchId: claim.batchId }
      }
      if (!(await dependencies.store.renewLease({ claim, renewedAt: startedAt, leaseUntil }))) {
        return { status: 'lease-lost' as const, batchId: claim.batchId }
      }
      const source = sources.get(claim.connection.providerKey)
      if (source === undefined) return finishFailure(claim, 'provider-unavailable', false, startedAt)

      let result
      try {
        result = await source.readPage({
          connection: claim.connection,
          cursor: claim.cursor,
          limit: 100,
          signal: AbortSignal.timeout(Math.min(dependencies.leaseMilliseconds, 60_000)),
        })
      } catch {
        return finishFailure(claim, 'provider-unavailable', true, dependencies.now().toISOString())
      }
      const finishedAt = dependencies.now().toISOString()
      if (result.kind === 'needs-user-action') {
        await dependencies.store.finishAttempt({
          claim,
          outcome: { kind: 'needs-user-action', code: result.code },
          finishedAt,
        })
        return { status: 'needs-user-action' as const, batchId: claim.batchId, code: result.code }
      }
      if (result.kind === 'failure') {
        const mayRetry = result.retryable && claim.attemptCount < dependencies.maximumAttempts
        const retryAt = mayRetry
          ? new Date(new Date(finishedAt).getTime() + dependencies.retryDelayMilliseconds(claim.attemptCount)).toISOString()
          : undefined
        await dependencies.store.finishAttempt({
          claim,
          outcome: {
            ...result,
            retryable: mayRetry,
            ...(retryAt === undefined ? {} : { retryAt }),
          },
          finishedAt,
        })
        return {
          status: mayRetry ? 'retry-scheduled' as const : 'failed' as const,
          batchId: claim.batchId,
          code: result.code,
        }
      }

      const retentionUntil = new Date(
        new Date(finishedAt).getTime() + dependencies.captureRetentionMilliseconds,
      ).toISOString()
      const artifactId = dependencies.nextId()
      const artifact = await dependencies.captureStore.put({
        artifactId,
        batchId: claim.batchId,
        providerKey: claim.connection.providerKey,
        body: result.capture.body,
        checksum: result.capture.checksum,
        contentType: result.capture.contentType,
        retentionUntil,
      })
      if (artifact.checksum !== result.capture.checksum) {
        return finishFailure(claim, 'capture-invalid', false, finishedAt)
      }
      const items: PreparedImportItem[] = result.items.map((item) =>
        prepareImportedPlaceItem(item, dependencies.nextId))
      let page
      try {
        page = await dependencies.store.recordPage({
          claim,
          capture: {
            artifactId,
            reference: artifact.reference,
            checksum: artifact.checksum,
            parserVersion: result.capture.parserVersion,
            acquisitionKind: result.capture.acquisitionKind,
            observedAt: result.capture.observedAt,
            retentionUntil,
          },
          items,
          nextCursor: result.nextCursor,
          recordedAt: finishedAt,
        })
      } catch (error) {
        if (error instanceof ImportLeaseLostError) {
          return { status: 'lease-lost' as const, batchId: claim.batchId }
        }
        throw error
      }
      return {
        status: 'processed' as const,
        batchId: claim.batchId,
        batchState: page.status,
        itemCount: items.length,
      }
    },
  }
}

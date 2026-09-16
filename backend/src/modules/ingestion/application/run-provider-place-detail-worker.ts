import type { IngestionStore } from './ports/ingestion-store.js'
import type {
  ProviderDetailFailureCode,
  ProviderPlaceDetailClaim,
  ProviderPlaceDetailJobStore,
  ProviderPlaceDetailSource,
} from './ports/provider-place-detail.js'
import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordSourceObservation } from './record-source-observation.js'
import {
  combineAbortSignals,
  createLeaseGuardian,
} from './provider-place-detail/lease-guardian.js'
import { ImportLeaseLostError } from '../domain/imports.js'

const MAXIMUM_RETRY_DELAY_MILLISECONDS = 15 * 60_000

function retryDelayMilliseconds(baseMilliseconds: number, attemptCount: number) {
  const exponent = Math.max(0, attemptCount - 1)
  const multiplier = 2 ** Math.min(exponent, 31)
  return Math.min(baseMilliseconds * multiplier, MAXIMUM_RETRY_DELAY_MILLISECONDS)
}

export function createProviderPlaceDetailWorker(dependencies: Readonly<{
  workerId: string
  store: ProviderPlaceDetailJobStore
  ingestionStore: IngestionStore
  sources: readonly ProviderPlaceDetailSource[]
  now: () => Date
  leaseMilliseconds: number
  maximumAttempts: number
  retryBaseMilliseconds: number
}>) {
  const sources = new Map(dependencies.sources.map((source) => [source.providerKey, source]))
  if (
    sources.size !== dependencies.sources.length ||
    sources.size === 0 ||
    dependencies.workerId.length === 0 ||
    !Number.isInteger(dependencies.leaseMilliseconds) ||
    dependencies.leaseMilliseconds <= 0 ||
    !Number.isInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts <= 0 ||
    !Number.isInteger(dependencies.retryBaseMilliseconds) ||
    dependencies.retryBaseMilliseconds <= 0
  ) throw new Error('Provider detail worker configuration is invalid.')

  async function finishFailure(
    claim: ProviderPlaceDetailClaim,
    code: ProviderDetailFailureCode,
    retryable: boolean,
    finishedAt: string,
  ) {
    const mayRetry = retryable && claim.attemptCount < dependencies.maximumAttempts
    const retryAt = mayRetry
      ? new Date(
          new Date(finishedAt).getTime() + retryDelayMilliseconds(
            dependencies.retryBaseMilliseconds,
            claim.attemptCount,
          ),
        ).toISOString()
      : undefined
    await dependencies.store.finishFailure({
      claim,
      code,
      retryable: mayRetry,
      ...(retryAt === undefined ? {} : { retryAt }),
      finishedAt,
    })
    return {
      status: mayRetry ? 'retry-scheduled' as const : 'failed' as const,
      jobId: claim.jobId,
      code,
    }
  }

  return {
    async runOne(processSignal?: AbortSignal) {
      const processAborted = () => processSignal?.aborted ?? false
      if (processAborted()) return { status: 'aborted' as const }

      const started = dependencies.now()
      const startedAt = started.toISOString()
      const leaseUntil = new Date(
        started.getTime() + dependencies.leaseMilliseconds,
      ).toISOString()
      const claim = await dependencies.store.claimNext({
        workerId: dependencies.workerId,
        providerKeys: [...sources.keys()],
        claimedAt: startedAt,
        leaseUntil,
      })
      if (claim === undefined) return { status: 'idle' as const }

      const guardian = createLeaseGuardian({
        claim,
        store: dependencies.store,
        now: dependencies.now,
        leaseMilliseconds: dependencies.leaseMilliseconds,
      })
      if (!(await guardian.renew())) return { status: 'lease-lost' as const, jobId: claim.jobId }
      if (processAborted()) return { status: 'aborted' as const, jobId: claim.jobId }
      guardian.start()

      const timeoutController = new AbortController()
      const timeout = setTimeout(
        () => timeoutController.abort(),
        Math.min(dependencies.leaseMilliseconds, 60_000),
      )
      const combined = combineAbortSignals([
        guardian.signal,
        timeoutController.signal,
        ...(processSignal === undefined ? [] : [processSignal]),
      ])
      const leaseLost = () => ({ status: 'lease-lost' as const, jobId: claim.jobId })
      const aborted = () => ({ status: 'aborted' as const, jobId: claim.jobId })
      const fence = async () => {
        if (guardian.isLost()) return false
        return guardian.renew()
      }
      const finishOwnedFailure = async (
        code: ProviderDetailFailureCode,
        retryable: boolean,
        finishedAt: string,
      ) => {
        try {
          return await finishFailure(claim, code, retryable, finishedAt)
        } catch (error) {
          if (error instanceof ImportLeaseLostError) return leaseLost()
          throw error
        }
      }

      try {
        const source = sources.get(claim.providerKey)
        if (source === undefined) {
          if (!(await fence())) return leaseLost()
          return finishOwnedFailure(
            'provider-unavailable',
            false,
            dependencies.now().toISOString(),
          )
        }

        let result
        try {
          result = await source.fetch({
            providerPlaceId: claim.providerPlaceId,
            signal: combined.signal,
          })
        } catch {
          if (guardian.isLost()) return leaseLost()
          if (processAborted()) return aborted()
          if (!(await fence())) return leaseLost()
          return finishOwnedFailure(
            'provider-unavailable',
            true,
            dependencies.now().toISOString(),
          )
        }

        const finishedAt = dependencies.now().toISOString()
        if (processAborted()) return aborted()
        if (!(await fence())) return leaseLost()
        if (result.kind === 'failure') {
          return finishOwnedFailure(result.code, result.retryable, finishedAt)
        }

        const detail = result.detail
        await recordSourceObservation({
          id: claim.observationId,
          providerKey: claim.providerKey,
          externalPlaceId: claim.providerPlaceId,
          observationKind: 'provider-detail',
          acquisitionKind: detail.acquisitionKind,
          payloadChecksum: detail.payloadChecksum,
          parserVersion: detail.parserVersion,
          observedAt: detail.observedAt,
          acquiredAt: finishedAt,
          ...(detail.captureReference === undefined
            ? {}
            : { captureReference: detail.captureReference }),
          facts: {
            name: detail.name,
            address: detail.address,
            categoryLabel: detail.categoryLabel,
            location: detail.location,
            attributes: detail.attributes,
          },
          confidence: detail.confidence,
          store: dependencies.ingestionStore,
        })
        if (processAborted()) return aborted()
        if (!(await fence())) return leaseLost()
        await recordPlaceCandidate({
          id: claim.candidateId,
          sourceObservationId: claim.observationId,
          parserVersion: detail.parserVersion,
          name: detail.name,
          ...(detail.address === null ? {} : { address: detail.address }),
          ...(detail.location === null ? {} : { location: detail.location }),
          attributes: {
            providerKey: claim.providerKey,
            externalPlaceId: claim.providerPlaceId,
            categoryLabel: detail.categoryLabel,
            detail: detail.attributes,
          },
          createdAt: finishedAt,
          store: dependencies.ingestionStore,
        })
        if (!(await fence())) return leaseLost()
        if (processAborted()) return aborted()
        try {
          await dependencies.store.complete({ claim, completedAt: finishedAt })
        } catch (error) {
          if (error instanceof ImportLeaseLostError) return leaseLost()
          throw error
        }
        return {
          status: 'completed' as const,
          jobId: claim.jobId,
          observationId: claim.observationId,
        }
      } finally {
        clearTimeout(timeout)
        combined.dispose()
        await guardian.stop()
      }
    },
  }
}

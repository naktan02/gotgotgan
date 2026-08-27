import type { IngestionStore } from './ports/ingestion-store.js'
import type {
  ProviderDetailFailureCode,
  ProviderPlaceDetailClaim,
  ProviderPlaceDetailJobStore,
  ProviderPlaceDetailSource,
} from './ports/provider-place-detail.js'
import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordSourceObservation } from './record-source-observation.js'

export function createProviderPlaceDetailWorker(dependencies: Readonly<{
  workerId: string
  store: ProviderPlaceDetailJobStore
  ingestionStore: IngestionStore
  sources: readonly ProviderPlaceDetailSource[]
  now: () => Date
  leaseMilliseconds: number
  maximumAttempts: number
  retryDelayMilliseconds: (attemptCount: number) => number
}>) {
  const sources = new Map(dependencies.sources.map((source) => [source.providerKey, source]))
  if (
    sources.size !== dependencies.sources.length ||
    sources.size === 0 ||
    dependencies.workerId.length === 0 ||
    !Number.isInteger(dependencies.leaseMilliseconds) ||
    dependencies.leaseMilliseconds <= 0 ||
    !Number.isInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts <= 0
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
          new Date(finishedAt).getTime() +
          dependencies.retryDelayMilliseconds(claim.attemptCount),
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
    async runOne() {
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
      if (!(await dependencies.store.renewLease({
        claim,
        renewedAt: startedAt,
        leaseUntil,
      }))) return { status: 'lease-lost' as const, jobId: claim.jobId }

      const source = sources.get(claim.providerKey)
      if (source === undefined) {
        return finishFailure(
          claim,
          'provider-unavailable',
          false,
          dependencies.now().toISOString(),
        )
      }

      let result
      try {
        result = await source.fetch({
          providerPlaceId: claim.providerPlaceId,
          signal: AbortSignal.timeout(Math.min(dependencies.leaseMilliseconds, 60_000)),
        })
      } catch {
        return finishFailure(
          claim,
          'provider-unavailable',
          true,
          dependencies.now().toISOString(),
        )
      }
      const finishedAt = dependencies.now().toISOString()
      if (result.kind === 'failure') {
        return finishFailure(claim, result.code, result.retryable, finishedAt)
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
      await dependencies.store.complete({ claim, completedAt: finishedAt })
      return {
        status: 'completed' as const,
        jobId: claim.jobId,
        observationId: claim.observationId,
      }
    },
  }
}

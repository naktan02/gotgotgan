import type { CanonicalPlaceMaterializationPort } from './ports/canonical-place-materialization.js'
import type {
  ImportedPlaceFulfillmentClaim,
  ImportedPlaceFulfillmentStore,
} from './ports/imported-place-fulfillment-store.js'
import type { ImportedPlaceLibraryPort } from './ports/imported-place-library.js'
import type { IngestionStore } from './ports/ingestion-store.js'
import type { PlaceEnrichmentSource } from './ports/place-enrichment-source.js'
import { recordImportedPlaceEvidence } from './record-imported-place-evidence.js'
import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordResolutionDecision } from './record-resolution-decision.js'
import { recordSourceObservation } from './record-source-observation.js'
import { ImportReferenceUnavailableError } from '../domain/imports.js'

const enrichmentPolicyVersion = 'connected-import-enrichment.v1'
const cacheHitPolicyVersion = 'connected-import-cache-hit.v1'

export function createImportedPlaceFulfillmentWorker(dependencies: Readonly<{
  workerId: string
  store: ImportedPlaceFulfillmentStore
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
  library: ImportedPlaceLibraryPort
  sources: readonly PlaceEnrichmentSource[]
  now: () => Date
  leaseMilliseconds: number
  maximumAttempts: number
  retryDelayMilliseconds: (attemptCount: number) => number
}>) {
  const sources = new Map(dependencies.sources.map((source) => [source.providerKey, source]))
  if (sources.size !== dependencies.sources.length) {
    throw new Error('Place enrichment source keys must be unique.')
  }
  if (
    dependencies.workerId.length === 0 ||
    !Number.isInteger(dependencies.leaseMilliseconds) || dependencies.leaseMilliseconds <= 0 ||
    !Number.isInteger(dependencies.maximumAttempts) || dependencies.maximumAttempts <= 0
  ) throw new Error('Imported place fulfillment worker configuration is invalid.')

  async function finishFailure(
    claim: ImportedPlaceFulfillmentClaim,
    code: 'provider-rate-limited' | 'provider-unavailable' | 'provider-parser-drift' | 'capture-invalid',
    retryable: boolean,
    finishedAt: string,
  ) {
    const mayRetry = retryable && claim.attemptCount < dependencies.maximumAttempts
    const retryAt = mayRetry
      ? new Date(
          new Date(finishedAt).getTime() + dependencies.retryDelayMilliseconds(claim.attemptCount),
        ).toISOString()
      : undefined
    await dependencies.store.finishFulfillmentJob({
      claim,
      outcome: {
        kind: 'failure',
        code,
        retryable: mayRetry,
        ...(retryAt === undefined ? {} : { retryAt }),
      },
      finishedAt,
    })
    return {
      status: mayRetry ? 'retry-scheduled' as const : 'failed' as const,
      jobId: claim.jobId,
      code,
    }
  }

  async function fulfill(
    claim: ImportedPlaceFulfillmentClaim,
    canonicalPlaceId: string,
    occurredAt: string,
  ) {
    let fulfilled = 0
    for (const item of claim.items) {
      await recordImportedPlaceEvidence({
        item,
        canonicalPlaceId,
        decisionKind: 'link-place',
        decidedBy: { kind: 'policy', reference: cacheHitPolicyVersion },
        rationale: 'connected-import:provider-identity-already-linked',
        occurredAt,
        store: dependencies.ingestionStore,
      })
      const saved = await dependencies.library.saveImportedPlace({
        commandId: item.itemId,
        memberId: item.memberId,
        canonicalPlaceId,
        occurredAt,
        source: {
          providerKey: item.providerKey,
          connectionId: item.connectionId,
          listId: item.sourceListId,
          listName: item.listName,
          listPosition: item.sourceListPosition,
          position: item.sourcePosition,
        },
      })
      if (saved.status !== 'applied' && saved.status !== 'replayed') {
        throw new ImportReferenceUnavailableError(`Imported place save failed: ${saved.status}`)
      }
      await dependencies.store.completeFulfillmentItem({
        claim,
        itemId: item.itemId,
        canonicalPlaceId,
        completedAt: occurredAt,
      })
      fulfilled += 1
    }
    await dependencies.store.finishFulfillmentJob({
      claim,
      outcome: { kind: 'completed', canonicalPlaceId },
      finishedAt: occurredAt,
    })
    return fulfilled
  }

  return {
    async runOne() {
      const started = dependencies.now()
      const startedAt = started.toISOString()
      const leaseUntil = new Date(started.getTime() + dependencies.leaseMilliseconds).toISOString()
      const claim = await dependencies.store.claimNextFulfillment({
        workerId: dependencies.workerId,
        claimedAt: startedAt,
        leaseUntil,
      })
      if (claim === undefined) return { status: 'idle' as const }
      if (!(await dependencies.store.renewFulfillmentLease({ claim, renewedAt: startedAt, leaseUntil }))) {
        return { status: 'lease-lost' as const, jobId: claim.jobId }
      }

      const identity = {
        providerKey: claim.providerKey,
        externalPlaceId: claim.providerPlaceId,
      }
      const existing = await dependencies.canonical.resolveProviderIdentity(identity)
      if (existing.status === 'linked') {
        const fulfilled = await fulfill(claim, existing.placeId, dependencies.now().toISOString())
        return {
          status: 'completed' as const,
          jobId: claim.jobId,
          canonicalPlaceId: existing.placeId,
          fulfilled,
        }
      }

      const source = sources.get(claim.providerKey)
      if (source === undefined) {
        return finishFailure(claim, 'provider-unavailable', false, dependencies.now().toISOString())
      }
      let result
      try {
        result = await source.readDetail({
          providerPlaceId: claim.providerPlaceId,
          signal: AbortSignal.timeout(Math.min(dependencies.leaseMilliseconds, 60_000)),
        })
      } catch {
        return finishFailure(claim, 'provider-unavailable', true, dependencies.now().toISOString())
      }
      const finishedAt = dependencies.now().toISOString()
      if (result.kind === 'failure') {
        return finishFailure(claim, result.code, result.retryable, finishedAt)
      }
      if (result.place.reviewReasons.length > 0) {
        await dependencies.store.finishFulfillmentJob({
          claim,
          outcome: { kind: 'needs-review', detail: result.place },
          finishedAt,
        })
        return { status: 'needs-review' as const, jobId: claim.jobId }
      }

      await recordSourceObservation({
        id: claim.observationId,
        providerKey: claim.providerKey,
        externalPlaceId: claim.providerPlaceId,
        acquisitionKind: result.evidence.acquisitionKind,
        payloadChecksum: result.evidence.checksum,
        parserVersion: result.evidence.parserVersion,
        observedAt: result.evidence.observedAt,
        acquiredAt: finishedAt,
        facts: result.place,
        confidence: 0.9,
        store: dependencies.ingestionStore,
      })
      await recordPlaceCandidate({
        id: claim.candidateId,
        sourceObservationId: claim.observationId,
        parserVersion: result.evidence.parserVersion,
        name: result.place.name,
        ...(result.place.address === null ? {} : { address: result.place.address }),
        ...(result.place.location === null ? {} : { location: result.place.location }),
        attributes: {
          categoryLabel: result.place.categoryLabel,
          providerKey: claim.providerKey,
          externalPlaceId: claim.providerPlaceId,
        },
        createdAt: finishedAt,
        store: dependencies.ingestionStore,
      })
      await recordResolutionDecision({
        id: claim.decisionId,
        candidateId: claim.candidateId,
        decision: { kind: 'create-place', canonicalPlaceId: claim.proposedPlaceId },
        decidedBy: { kind: 'policy', reference: enrichmentPolicyVersion },
        evidenceObservationIds: [claim.observationId],
        rationale: 'connected-import:verified-provider-detail',
        decidedAt: finishedAt,
        store: dependencies.ingestionStore,
      })
      let canonicalPlaceId = claim.proposedPlaceId
      const applied = await dependencies.canonical.apply({
        decisionId: claim.decisionId,
        sourceDecisionId: claim.decisionId,
        command: {
          kind: 'create-place',
          placeId: claim.proposedPlaceId,
          providerIdentity: identity,
        },
        policyVersion: enrichmentPolicyVersion,
        occurredAt: finishedAt,
      })
      if (applied.status === 'identity-already-linked') {
        const linked = await dependencies.canonical.resolveProviderIdentity(identity)
        if (linked.status !== 'linked') {
          throw new ImportReferenceUnavailableError('Provider identity link is unavailable.')
        }
        canonicalPlaceId = linked.placeId
      } else if (applied.status !== 'applied' && applied.status !== 'replayed') {
        throw new ImportReferenceUnavailableError(`Canonical enrichment failed: ${applied.status}`)
      }
      const fulfilled = await fulfill(claim, canonicalPlaceId, finishedAt)
      return {
        status: 'completed' as const,
        jobId: claim.jobId,
        canonicalPlaceId,
        fulfilled,
      }
    },
  }
}

import type { CanonicalPlaceMaterializationPort } from './ports/canonical-place-materialization.js'
import type {
  ImportedPlaceFulfillmentClaim,
  ImportedPlaceFulfillmentStore,
} from './ports/imported-place-fulfillment-store.js'
import type { ImportedPlaceLibraryPort } from './ports/imported-place-library.js'
import type { IngestionStore } from './ports/ingestion-store.js'
import { recordImportedPlaceEvidence } from './record-imported-place-evidence.js'
import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordResolutionDecision } from './record-resolution-decision.js'
import { recordSourceObservation } from './record-source-observation.js'
import { ImportReferenceUnavailableError } from '../domain/imports.js'

const snapshotPolicyVersion = 'connected-import-source-snapshot.v1'
const cacheHitPolicyVersion = 'connected-import-cache-hit.v1'

export function createImportedPlaceFulfillmentWorker(dependencies: Readonly<{
  workerId: string
  store: ImportedPlaceFulfillmentStore
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
  library: ImportedPlaceLibraryPort
  now: () => Date
  leaseMilliseconds: number
}>) {
  if (
    dependencies.workerId.length === 0 ||
    !Number.isInteger(dependencies.leaseMilliseconds) || dependencies.leaseMilliseconds <= 0
  ) throw new Error('Imported place fulfillment worker configuration is invalid.')

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
          itemId: item.sourceItemId,
          providerPlaceId: item.providerPlaceId,
          listName: item.listName,
          listPosition: item.sourceListPosition,
          position: item.sourcePosition,
        },
      })
      if (saved.status !== 'applied' && saved.status !== 'replayed') {
        throw new ImportReferenceUnavailableError(`Imported place save failed: ${saved.status}`)
      }
      fulfilled += 1
    }
    await dependencies.store.completeFulfillmentItems({
      claim,
      itemIds: claim.items.map((item) => item.itemId),
      canonicalPlaceId,
      completedAt: occurredAt,
    })
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
      const finishedAt = dependencies.now().toISOString()
      const sourceItem = claim.items[0]
      if (sourceItem === undefined) {
        throw new ImportReferenceUnavailableError('Imported place source snapshot is unavailable.')
      }

      await recordSourceObservation({
        id: claim.observationId,
        providerKey: claim.providerKey,
        externalPlaceId: claim.providerPlaceId,
        acquisitionKind: sourceItem.capture.acquisitionKind,
        payloadChecksum: sourceItem.capture.checksum,
        parserVersion: sourceItem.capture.parserVersion,
        observedAt: sourceItem.capture.observedAt,
        acquiredAt: finishedAt,
        captureReference: sourceItem.capture.reference,
        facts: {
          name: sourceItem.name,
          address: sourceItem.address,
          categoryLabel: sourceItem.categoryLabel,
          location: sourceItem.location,
          listName: sourceItem.listName,
        },
        confidence: 0.8,
        store: dependencies.ingestionStore,
      })
      await recordPlaceCandidate({
        id: claim.candidateId,
        sourceObservationId: claim.observationId,
        parserVersion: sourceItem.capture.parserVersion,
        name: sourceItem.name,
        ...(sourceItem.address === null ? {} : { address: sourceItem.address }),
        ...(sourceItem.location === null ? {} : { location: sourceItem.location }),
        attributes: {
          categoryLabel: sourceItem.categoryLabel,
          providerKey: claim.providerKey,
          externalPlaceId: claim.providerPlaceId,
          sourceListId: sourceItem.sourceListId,
          sourceItemId: sourceItem.sourceItemId,
        },
        createdAt: finishedAt,
        store: dependencies.ingestionStore,
      })
      await recordResolutionDecision({
        id: claim.decisionId,
        candidateId: claim.candidateId,
        decision: { kind: 'create-place', canonicalPlaceId: claim.proposedPlaceId },
        decidedBy: { kind: 'policy', reference: snapshotPolicyVersion },
        evidenceObservationIds: [claim.observationId],
        rationale: 'connected-import:source-snapshot-save-intent',
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
        policyVersion: snapshotPolicyVersion,
        occurredAt: finishedAt,
      })
      if (applied.status === 'identity-already-linked') {
        const linked = await dependencies.canonical.resolveProviderIdentity(identity)
        if (linked.status !== 'linked') {
          throw new ImportReferenceUnavailableError('Provider identity link is unavailable.')
        }
        canonicalPlaceId = linked.placeId
      } else if (applied.status !== 'applied' && applied.status !== 'replayed') {
        throw new ImportReferenceUnavailableError(`Canonical materialization failed: ${applied.status}`)
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

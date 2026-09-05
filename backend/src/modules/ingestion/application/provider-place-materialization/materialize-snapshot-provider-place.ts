import type { AcquisitionKind, GeoPoint } from '../../domain/model.js'
import type { CanonicalPlaceMaterializationPort } from '../ports/canonical-place-materialization.js'
import type { IngestionStore } from '../ports/ingestion-store.js'
import { recordPlaceCandidate } from '../record-place-candidate.js'
import { recordSourceObservation } from '../record-source-observation.js'
import {
  materializeVerifiedProviderPlace,
  type VerifiedProviderPlaceMaterialization,
} from './materialize-verified-provider-place.js'

export type SnapshotProviderPlaceEvidence = Readonly<{
  acquisitionKind: AcquisitionKind
  parserVersion: string
  payloadChecksum: string
  observedAt: string
  acquiredAt: string
  name: string
  address: string | null
  categoryLabel: string | null
  location: GeoPoint | null
}>

/** Records minimum bookmark facts without claiming Provider-detail availability. */
export async function materializeSnapshotProviderPlace(input: Readonly<{
  evidence: VerifiedProviderPlaceMaterialization
  snapshot: SnapshotProviderPlaceEvidence
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
}>) {
  const { evidence, snapshot, ingestionStore: store } = input
  await recordSourceObservation({
    id: evidence.sourceObservationId,
    providerKey: evidence.providerKey,
    externalPlaceId: evidence.externalPlaceId,
    observationKind: 'general',
    acquisitionKind: snapshot.acquisitionKind,
    parserVersion: snapshot.parserVersion,
    payloadChecksum: snapshot.payloadChecksum,
    observedAt: snapshot.observedAt,
    acquiredAt: snapshot.acquiredAt,
    facts: {
      name: snapshot.name, address: snapshot.address,
      categoryLabel: snapshot.categoryLabel, location: snapshot.location,
    },
    confidence: 0.8,
    store,
  })
  await recordPlaceCandidate({
    id: evidence.placeCandidateId,
    sourceObservationId: evidence.sourceObservationId,
    parserVersion: snapshot.parserVersion,
    name: snapshot.name,
    ...(snapshot.address === null ? {} : { address: snapshot.address }),
    ...(snapshot.location === null ? {} : { location: snapshot.location }),
    attributes: { categoryLabel: snapshot.categoryLabel },
    createdAt: snapshot.acquiredAt,
    store,
  })
  return materializeVerifiedProviderPlace(input)
}

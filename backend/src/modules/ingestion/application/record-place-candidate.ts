import {
  assertGeoPoint,
  assertIsoTimestamp,
  InvalidIngestionRecordError,
  type PlaceCandidateRecord,
} from '../domain/model.js'
import { appendIngestionRecord } from './append-record.js'
import { fingerprint } from './fingerprint.js'
import type { IngestionStore } from './ports/ingestion-store.js'

export async function recordPlaceCandidate(
  input: Omit<PlaceCandidateRecord, 'kind' | 'fingerprint'> & Readonly<{ store: IngestionStore }>,
) {
  assertGeoPoint(input.location)
  assertIsoTimestamp(input.createdAt, 'createdAt')
  if (input.sourceObservationId.length === 0 || input.parserVersion.length === 0 || input.name.trim().length === 0) {
    throw new InvalidIngestionRecordError('sourceObservationId, parserVersion, and name are required')
  }
  const { store, ...values } = input
  const record: PlaceCandidateRecord = {
    kind: 'place-candidate',
    ...values,
    name: values.name.trim(),
    fingerprint: fingerprint({ kind: 'place-candidate', ...values, name: values.name.trim() }),
  }
  return appendIngestionRecord(record, store)
}

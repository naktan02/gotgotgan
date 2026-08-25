import {
  assertIsoTimestamp,
  assertProviderKey,
  InvalidIngestionRecordError,
  type SourceObservationRecord,
} from '../domain/model.js'
import { appendIngestionRecord } from './append-record.js'
import { fingerprint } from './fingerprint.js'
import type { IngestionStore } from './ports/ingestion-store.js'

export async function recordSourceObservation(
  input: Omit<SourceObservationRecord, 'kind' | 'fingerprint'> & Readonly<{ store: IngestionStore }>,
) {
  assertProviderKey(input.providerKey)
  assertIsoTimestamp(input.observedAt, 'observedAt')
  assertIsoTimestamp(input.acquiredAt, 'acquiredAt')
  if (input.externalPlaceId.length === 0 || input.parserVersion.length === 0) {
    throw new InvalidIngestionRecordError('externalPlaceId and parserVersion are required')
  }
  if (!/^[a-f0-9]{64}$/.test(input.payloadChecksum)) {
    throw new InvalidIngestionRecordError('payloadChecksum must be a lowercase SHA-256 digest')
  }
  if (input.confidence < 0 || input.confidence > 1) {
    throw new InvalidIngestionRecordError('confidence must be between zero and one')
  }
  const { store, ...values } = input
  const record: SourceObservationRecord = {
    kind: 'source-observation',
    ...values,
    fingerprint: fingerprint({ kind: 'source-observation', ...values }),
  }
  return appendIngestionRecord(record, store)
}

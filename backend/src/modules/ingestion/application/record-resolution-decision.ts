import {
  assertIsoTimestamp,
  InvalidIngestionRecordError,
  type ResolutionDecisionRecord,
} from '../domain/model.js'
import { appendIngestionRecord } from './append-record.js'
import { fingerprint } from './fingerprint.js'
import type { IngestionStore } from './ports/ingestion-store.js'

export async function recordResolutionDecision(
  input: Omit<ResolutionDecisionRecord, 'kind' | 'fingerprint'> & Readonly<{ store: IngestionStore }>,
) {
  assertIsoTimestamp(input.decidedAt, 'decidedAt')
  const candidateDecision = new Set([
    'needs-review', 'explicit-not-same', 'create-place', 'link-place',
  ]).has(input.decision.kind)
  if (
    (candidateDecision && (input.candidateId === undefined || input.candidateId.length === 0)) ||
    input.decidedBy.reference.length === 0 ||
    input.evidenceObservationIds.length === 0 || input.rationale.trim().length === 0
  ) {
    throw new InvalidIngestionRecordError(
      'decision requires any applicable candidate plus actor, evidence, and rationale',
    )
  }
  if (
    input.decision.kind === 'merge-places' &&
    input.decision.sourceCanonicalPlaceId === input.decision.targetCanonicalPlaceId
  ) {
    throw new InvalidIngestionRecordError('merge decision requires two distinct Canonical Places')
  }
  if (
    input.decision.kind === 'split-provider-identity' &&
    input.decision.sourceCanonicalPlaceId === input.decision.newCanonicalPlaceId
  ) {
    throw new InvalidIngestionRecordError('split decision requires a distinct new Canonical Place')
  }
  const evidenceObservationIds = [...new Set(input.evidenceObservationIds)].sort()
  const { store, ...values } = input
  const normalized = { ...values, evidenceObservationIds, rationale: values.rationale.trim() }
  const record: ResolutionDecisionRecord = {
    kind: 'resolution-decision',
    ...normalized,
    fingerprint: fingerprint({ kind: 'resolution-decision', ...normalized }),
  }
  return appendIngestionRecord(record, store)
}

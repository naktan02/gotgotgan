import type { PoolClient } from 'pg'

import { fingerprintLibraryCommand } from '../../application/fingerprint.js'
import type {
  LibraryWriteRejection,
  LibraryWriteResult,
} from '../../domain/collection-first.js'

type OperationReceiptRow = Readonly<{
  membership_id: string
  operation_kind: string
  operation_fingerprint: string
  outcome: string
  result: Record<string, unknown>
}>

const operationNamespace = 'gotgotgan.library.v2'

export function libraryOperationFingerprint(
  kind: string,
  memberId: string,
  input: Record<string, unknown>,
): string {
  return fingerprintLibraryCommand({ namespace: operationNamespace, kind, memberId, input })
}

export async function lockLibraryOperation(client: PoolClient, operationId: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.library.v2:' || $1, 0))",
    [operationId],
  )
}

export async function readPriorLibraryOperation<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
  }>,
): Promise<LibraryWriteResult<Value> | undefined> {
  const result = await client.query<OperationReceiptRow>(
    `SELECT membership_id, operation_kind, operation_fingerprint, outcome, result
     FROM library.operation_receipts_v2 WHERE operation_id = $1::uuid`,
    [input.operationId],
  )
  const prior = result.rows[0]
  if (prior === undefined) return undefined
  if (
    prior.membership_id !== input.memberId || prior.operation_kind !== input.kind ||
    prior.operation_fingerprint !== input.fingerprint
  ) {
    return {
      status: 'rejected', operationId: input.operationId,
      rejection: { code: 'operation-id-reused' },
    }
  }
  if (prior.outcome === 'applied') {
    return { status: 'replayed', operationId: input.operationId, value: prior.result.value as Value }
  }
  return {
    status: 'rejected', operationId: input.operationId,
    rejection: prior.result.rejection as LibraryWriteRejection,
  }
}

export async function recordAppliedLibraryOperation<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
    occurredAt: string
    value: Value
  }>,
): Promise<LibraryWriteResult<Value>> {
  await client.query(
    `INSERT INTO library.operation_receipts_v2 (
       operation_id, membership_id, operation_kind, operation_fingerprint,
       outcome, result, occurred_at
     ) VALUES ($1::uuid,$2::uuid,$3,$4,'applied',$5::jsonb,$6::timestamptz)`,
    [input.operationId, input.memberId, input.kind, input.fingerprint,
      JSON.stringify({ value: input.value }), input.occurredAt],
  )
  return { status: 'applied', operationId: input.operationId, value: input.value }
}

export async function recordRejectedLibraryOperation<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
    occurredAt: string
    rejection: LibraryWriteRejection
  }>,
): Promise<LibraryWriteResult<Value>> {
  await client.query(
    `INSERT INTO library.operation_receipts_v2 (
       operation_id, membership_id, operation_kind, operation_fingerprint,
       outcome, result, occurred_at
     ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::timestamptz)`,
    [input.operationId, input.memberId, input.kind, input.fingerprint,
      input.rejection.code, JSON.stringify({ rejection: input.rejection }), input.occurredAt],
  )
  return { status: 'rejected', operationId: input.operationId, rejection: input.rejection }
}

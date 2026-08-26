import { fingerprint } from './fingerprint.js'
import type { ImportRequestStore } from './ports/import-request-store.js'
import {
  ImportRequestConflictError,
  ProviderConnectionUnavailableError,
} from '../domain/imports.js'

export async function requestPlaceImport(input: Readonly<{
  memberId: string
  connectionId: string
  idempotencyKey: string
  nextBatchId: () => string
  nextJobId: () => string
  now: () => Date
  store: ImportRequestStore
}>) {
  const requestedAt = input.now().toISOString()
  const result = await input.store.requestImport({
    memberId: input.memberId,
    connectionId: input.connectionId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: fingerprint({
      memberId: input.memberId,
      connectionId: input.connectionId,
    }),
    batchId: input.nextBatchId(),
    jobId: input.nextJobId(),
    requestedAt,
  })
  if (result.status === 'created' || result.status === 'replayed') return result
  if (result.status === 'connection-unavailable') {
    throw new ProviderConnectionUnavailableError('Provider connection is unavailable.')
  }
  throw new ImportRequestConflictError('Import request conflicts with an earlier request.')
}

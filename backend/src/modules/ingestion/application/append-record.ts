import { IngestionIdConflictError, type IngestionRecord } from '../domain/model.js'
import type { IngestionStore } from './ports/ingestion-store.js'

export async function appendIngestionRecord(
  record: IngestionRecord,
  store: IngestionStore,
): Promise<Readonly<{ status: 'recorded' | 'replayed' }>> {
  const outcome = await store.append(record)
  if (outcome === 'conflict') throw new IngestionIdConflictError(`record id ${record.id} is already used`)
  return { status: outcome }
}

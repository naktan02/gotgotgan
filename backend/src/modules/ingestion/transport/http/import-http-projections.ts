import type { PlaceImportBatch, PlaceImportItem } from '../../domain/imports.js'

export function importBatchProjection(batch: PlaceImportBatch) {
  return { schemaVersion: 'place-import-batch.v1' as const, ...batch }
}

export function importItemProjection(item: PlaceImportItem) {
  return { schemaVersion: 'place-import-item.v1' as const, ...item }
}

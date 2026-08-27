import type { ImportBatchState, PlaceImportBatch, PlaceImportItem } from './imports.js'

export type ImportBatchStateFilter = 'all' | ImportBatchState

export type ImportBatchListPage = Readonly<{
  schemaVersion: 'place-import-batch-list.v1'
  filter: Readonly<{ state: ImportBatchStateFilter }>
  items: readonly PlaceImportBatch[]
  nextCursor?: string
}>

export type ImportBatchDetailPage = Readonly<{
  schemaVersion: 'place-import-batch-detail.v1'
  batch: PlaceImportBatch
  items: readonly PlaceImportItem[]
  nextCursor?: string
}>

export class InvalidImportCursorError extends Error {
  override readonly name = 'InvalidImportCursorError'
}

export class InvalidImportQueryError extends Error {
  override readonly name = 'InvalidImportQueryError'
}

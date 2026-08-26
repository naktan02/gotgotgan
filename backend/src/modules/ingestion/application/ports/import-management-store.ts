import type { PlaceImportBatch, PlaceImportBatchDetail } from '../../domain/imports.js'

export interface ImportManagementStore {
  getImport(memberId: string, batchId: string): Promise<PlaceImportBatchDetail | undefined>
  cancelImport(memberId: string, batchId: string, cancelledAt: string): Promise<PlaceImportBatch | undefined>
  resumeImport(memberId: string, batchId: string, resumedAt: string): Promise<PlaceImportBatch | undefined>
}

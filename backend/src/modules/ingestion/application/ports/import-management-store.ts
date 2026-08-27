import type { PlaceImportBatch } from '../../domain/imports.js'

export interface ImportManagementStore {
  cancelImport(memberId: string, batchId: string, cancelledAt: string): Promise<PlaceImportBatch | undefined>
  resumeImport(memberId: string, batchId: string, resumedAt: string): Promise<PlaceImportBatch | undefined>
}

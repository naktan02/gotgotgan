import type { PlaceImportBatch } from '../../domain/imports.js'

export type ImportRequestCommand = Readonly<{
  memberId: string
  connectionId: string
  idempotencyKey: string
  requestFingerprint: string
  batchId: string
  jobId: string
  requestedAt: string
}>

export interface ImportRequestStore {
  requestImport(command: ImportRequestCommand): Promise<
    | Readonly<{ status: 'created' | 'replayed'; batch: PlaceImportBatch }>
    | Readonly<{ status: 'connection-unavailable' | 'conflict' }>
  >
}

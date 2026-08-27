import type {
  ImportBatchDetailPage,
  ImportBatchListPage,
  ImportBatchStateFilter,
} from '../domain/import-queries.js'

export interface ImportQueries {
  listBatches(input: Readonly<{
    memberId: string
    state: ImportBatchStateFilter
    cursor?: string
    limit: number
  }>): Promise<ImportBatchListPage>

  getBatch(input: Readonly<{
    memberId: string
    batchId: string
    cursor?: string
    limit: number
  }>): Promise<ImportBatchDetailPage | undefined>
}

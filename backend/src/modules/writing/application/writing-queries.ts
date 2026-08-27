import type {
  WritingDetail,
  WritingKindFilter,
  WritingListPage,
} from '../domain/queries.js'

export interface WritingQueries {
  list(input: Readonly<{
    memberId: string
    kind: WritingKindFilter
    cursor?: string
    limit: number
  }>): Promise<WritingListPage>

  get(input: Readonly<{
    memberId: string
    documentId: string
  }>): Promise<WritingDetail | undefined>
}

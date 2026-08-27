export type WritingKindFilter = 'all' | 'note' | 'entry'
export type WritingVisibility = 'private' | 'unlisted' | 'public'

type WritingSummaryCommon = Readonly<{
  documentId: string
  bodyPreview: string
  bodyTruncated: boolean
  visibility: WritingVisibility
  publicationId: string | null
  version: number
  placeIds: readonly string[]
  updatedAt: string
}>

export type WritingSummary =
  | (WritingSummaryCommon & Readonly<{ kind: 'note'; title: null }>)
  | (WritingSummaryCommon & Readonly<{ kind: 'entry'; title: string }>)

export type WritingListPage = Readonly<{
  schemaVersion: 'writing-list.v1'
  filter: Readonly<{ kind: WritingKindFilter }>
  items: readonly WritingSummary[]
  nextCursor?: string
}>

type WritingDocumentCommon = Readonly<{
  documentId: string
  body: string
  visibility: WritingVisibility
  publicationId: string | null
  version: number
  placeIds: readonly string[]
  createdAt: string
  updatedAt: string
}>

export type WritingDocument =
  | (WritingDocumentCommon & Readonly<{ kind: 'note'; title: null }>)
  | (WritingDocumentCommon & Readonly<{ kind: 'entry'; title: string }>)

export type WritingDetail = Readonly<{
  schemaVersion: 'writing-detail.v1'
  document: WritingDocument
}>

export class InvalidWritingCursorError extends Error {
  override readonly name = 'InvalidWritingCursorError'
}

export class InvalidWritingQueryError extends Error {
  override readonly name = 'InvalidWritingQueryError'
}

import type { AcquisitionKind } from '../../domain/model.js'

export type ImportReviewAction =
  | Readonly<{ kind: 'create-place' }>
  | Readonly<{ kind: 'link-place'; canonicalPlaceId: string }>
  | Readonly<{ kind: 'skip'; reason?: string }>

export type ReviewableImportItem = Readonly<{
  itemId: string
  batchId: string
  memberId: string
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  providerPlaceId?: string
  sourceListId: string
  sourceItemId: string
  sourceListPosition: number
  sourcePosition: number
  listName: string
  name: string
  address: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  observationId: string
  candidateId: string
  decisionId: string
  proposedPlaceId: string
  capture: Readonly<{
    reference: string
    checksum: string
    parserVersion: string
    acquisitionKind: AcquisitionKind
    observedAt: string
  }>
}>

export type ImportReviewResult = Readonly<{
  status: 'applied' | 'skipped' | 'replayed'
  commandId: string
  itemId: string
  canonicalPlaceId?: string
}>

export interface ImportReviewStore {
  beginReview(input: Readonly<{
    memberId: string
    commandId: string
    itemId: string
    actionKind: ImportReviewAction['kind']
    requestFingerprint: string
    occurredAt: string
  }>): Promise<
    | Readonly<{ status: 'ready'; item: ReviewableImportItem }>
    | Readonly<{ status: 'replayed'; result: ImportReviewResult }>
    | Readonly<{ status: 'not-found' }>
    | Readonly<{ status: 'conflict' }>
    | Readonly<{ status: 'invalid' }>
  >
  completeReview(input: Readonly<{
    memberId: string
    commandId: string
    itemId: string
    status: 'applied' | 'skipped'
    canonicalPlaceId?: string
    completedAt: string
  }>): Promise<ImportReviewResult>
}

export type ExpiredImportCapture = Readonly<{
  captureId: string
  batchId: string
  providerKey: 'naver' | 'kakao' | 'google'
  artifactReference: string
}>

export interface ImportCaptureRetentionStore {
  findExpired(input: Readonly<{
    expiredAt: string
    limit: number
  }>): Promise<readonly ExpiredImportCapture[]>
  markDeleted(input: Readonly<{
    captureId: string
    deletedAt: string
  }>): Promise<'marked' | 'already-deleted'>
}

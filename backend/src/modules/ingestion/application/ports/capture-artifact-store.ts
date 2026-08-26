export interface CaptureArtifactStore {
  put(input: Readonly<{
    artifactId: string
    batchId: string
    providerKey: 'naver' | 'kakao' | 'google'
    body: Uint8Array
    checksum: string
    contentType: 'application/json'
    retentionUntil: string
  }>): Promise<Readonly<{ reference: string; checksum: string }>>
}

export interface CaptureArtifactReplayStore extends CaptureArtifactStore {
  get(input: Readonly<{
    reference: string
    batchId: string
    providerKey: 'naver' | 'kakao' | 'google'
  }>): Promise<Uint8Array | undefined>
  delete(input: Readonly<{
    reference: string
    batchId: string
    providerKey: 'naver' | 'kakao' | 'google'
  }>): Promise<'deleted' | 'missing'>
}

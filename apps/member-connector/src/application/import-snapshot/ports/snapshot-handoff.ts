import type {
  ConnectorCaptureChunkReceiptV2,
  ConnectorCaptureChunkV2,
  ConnectorCaptureCompleteResultV2,
  ConnectorCaptureManifestStatusV2,
  ConnectorCaptureManifestV2,
  ConnectorImportGrantRequestV2,
  ConnectorImportGrantResultV2,
  ConnectorImportGrantV2,
} from '@place/contracts/transfers'

export type ConnectorSnapshotIdentity = Readonly<{
  operationId: string
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  accountFingerprint: string
  installationId: string
  manifestId: string
}>

export type ConnectorSnapshotGrantAttempt = Readonly<{
  commandId: string
  expectedConnectionRevision: string
  placeOrigin: string
}>

export type ConnectorSnapshotChunkDescriptor = Readonly<
  Pick<ConnectorCaptureChunkV2, 'sequence' | 'itemCount' | 'byteCount' | 'checksum'>
>

export type ConnectorSnapshotSpoolStatus =
  | Readonly<{
      state: 'collecting'
      observedAt: string
      capturedAt: string
    }>
  | Readonly<{ state: 'sealed'; manifest: ConnectorCaptureManifestV2 }>

/**
 * Local, private staging seam. Implementations key data only by the stable snapshot identity (never
 * a replaceable grant command), encrypt it at rest, and return conflict rather than overwrite.
 */
export interface ConnectorSnapshotSpool {
  open(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    observedAt: string
    capturedAt: string
    signal: AbortSignal
  }>): Promise<ConnectorSnapshotSpoolStatus>

  stage(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    chunk: ConnectorCaptureChunkV2
    signal: AbortSignal
  }>): Promise<'recorded' | 'replayed' | 'conflict'>

  seal(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    manifest: ConnectorCaptureManifestV2
    signal: AbortSignal
  }>): Promise<'sealed' | 'replayed' | 'conflict'>

  read(input: Readonly<{
    identity: ConnectorSnapshotIdentity
    fromSequence: number
    signal: AbortSignal
  }>): AsyncIterable<ConnectorCaptureChunkV2>
}

/** Backend handoff seam. A manifest is complete only after complete() says completed/replayed. */
export interface ConnectorSnapshotHandoff {
  issueGrant(input: Readonly<{
    request: ConnectorImportGrantRequestV2
    signal: AbortSignal
  }>): Promise<ConnectorImportGrantResultV2>

  status(input: Readonly<{
    grant: ConnectorImportGrantV2
    signal: AbortSignal
  }>): Promise<ConnectorCaptureManifestStatusV2>

  upload(input: Readonly<{
    grant: ConnectorImportGrantV2
    chunk: ConnectorCaptureChunkV2
    signal: AbortSignal
  }>): Promise<ConnectorCaptureChunkReceiptV2>

  complete(input: Readonly<{
    grant: ConnectorImportGrantV2
    manifest: ConnectorCaptureManifestV2
    signal: AbortSignal
  }>): Promise<ConnectorCaptureCompleteResultV2>
}

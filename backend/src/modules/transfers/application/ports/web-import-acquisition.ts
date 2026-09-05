import type {
  ImportAcquisitionCommandResultV1,
  ImportAcquisitionCommandV1,
  ImportAcquisitionV1,
  StartImportAcquisitionV1,
} from '@place/contracts/transfers'

import type { SharedLinkInspectionResult } from '../../domain/acquisitions.js'
import type { SourceSnapshotCaptureV3 } from '../../domain/model.js'

export type WebImportArtifact = Readonly<{
  artifactId: string
  reference: string
  checksum: string
  retainedUntil: string
}>

export type WebImportStartRequest =
  | Extract<StartImportAcquisitionV1, { kind: 'remote-browser' }>
  | Omit<Extract<StartImportAcquisitionV1, { kind: 'shared-links' }>, 'links'> & Readonly<{
      links: readonly Readonly<{ entryId: string; position: number }>[]
    }>

export type WebImportAcquisitionClaim = Readonly<{
  acquisitionId: string
  ownerMemberId: string
  importSourceId: string
  providerKey: 'naver'
  snapshotId: string
  artifact: WebImportArtifact
  observedAt: string
  inspectionResults?: readonly SharedLinkInspectionResult[]
  lease: Readonly<{
    owner: string
    generation: number
    expiresAt: string
  }>
}>

export interface WebImportAcquisitionStore {
  reserve(input: Readonly<{
    memberId: string
    command: WebImportStartRequest
    requestFingerprint: string
    inputDigests: readonly string[]
    artifact?: WebImportArtifact
    startedAt: string
  }>): Promise<
    | Readonly<{ status: 'reserved'; artifact: WebImportArtifact }>
    | Readonly<{ status: 'complete'; result: ImportAcquisitionCommandResultV1 }>
  >
  activate(input: Readonly<{
    memberId: string
    commandId: string
    acquisitionId: string
    activatedAt: string
  }>): Promise<Readonly<{
    result: ImportAcquisitionCommandResultV1
    artifactRequired: boolean
  }>>
  get(memberId: string, acquisitionId: string): Promise<ImportAcquisitionV1 | undefined>
  cancel(input: Readonly<{
    memberId: string
    command: ImportAcquisitionCommandV1
    commandFingerprint: string
    cancelledAt: string
  }>): Promise<Readonly<{
    result: ImportAcquisitionCommandResultV1
    artifact?: Readonly<{ reference: string; acquisitionId: string; providerKey: 'naver' }>
  }>>
  claim(input: Readonly<{
    workerId: string
    claimedAt: string
    leaseUntil: string
  }>): Promise<WebImportAcquisitionClaim | undefined>
  recordInspectionSnapshot(input: Readonly<{
    claim: WebImportAcquisitionClaim
    results: readonly SharedLinkInspectionResult[]
    snapshot?: SourceSnapshotCaptureV3
    recordedAt: string
  }>): Promise<void>
  complete(input: Readonly<{
    claim: WebImportAcquisitionClaim
    results: readonly SharedLinkInspectionResult[]
    completedAt: string
  }>): Promise<void>
  expire(input: Readonly<{
    claim: WebImportAcquisitionClaim
    expiredAt: string
  }>): Promise<void>
  pendingArtifactCleanup(limit: number): Promise<readonly Readonly<{
    acquisitionId: string
    providerKey: 'naver'
    reference: string
  }>[]>
  markArtifactDeleted(acquisitionId: string, deletedAt: string): Promise<void>
}

export interface WebImportArtifactStore {
  reference(artifactId: string): string
  put(input: Readonly<{
    artifactId: string
    batchId: string
    providerKey: 'naver'
    body: Uint8Array
    checksum: string
    contentType: 'application/json'
    retentionUntil: string
  }>): Promise<Readonly<{ reference: string; checksum: string }>>
  get(input: Readonly<{
    reference: string
    batchId: string
    providerKey: 'naver'
  }>): Promise<Uint8Array | undefined>
  discard(input: Readonly<{
    reference: string
    batchId: string
    providerKey: 'naver'
  }>): Promise<'deleted' | 'missing'>
}

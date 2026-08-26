import type {
  ConnectorBrowserKey,
  ConnectorCaptureReceipt,
  ConnectorProviderKey,
} from '@place/contracts/connector'

import type { PreparedImportItem } from './import-worker-store.js'

export type ConnectorImportLimits = Readonly<{
  maximumItems: number
  maximumBytes: number
  maximumBatches: number
  maximumBatchBytes: number
}>

export type ConnectorImportGrantCommand = Readonly<{
  operationId: string
  memberId: string
  connectionId: string
  batchId: string
  installationId: string
  browserKey: ConnectorBrowserKey
  providerKey: ConnectorProviderKey
  idempotencyKey: string
  requestFingerprint: string
  tokenDigest: string
  placeOrigin: string
  expiresAt: string
  limits: ConnectorImportLimits
  issuedAt: string
}>

export type ConnectorCaptureReservation = Readonly<{
  operationId: string
  tokenDigest: string
  placeOrigin: string
  providerKey: ConnectorProviderKey
  sequence: number
  final: boolean
  itemCount: number
  byteCount: number
  checksum: string
  artifactId: string
  artifactReference: string
  parserVersion: string
  acquisitionKind: 'browser-network' | 'browser-dom'
  observedAt: string
  retentionUntil: string
  reservedAt: string
}>

export type ConnectorCaptureCommit = Readonly<{
  operationId: string
  tokenDigest: string
  sequence: number
  checksum: string
  items: readonly PreparedImportItem[]
  committedAt: string
}>

export type ConnectorCaptureRejection =
  | 'invalid-grant'
  | 'grant-expired'
  | 'origin-mismatch'
  | 'operation-conflict'
  | 'limit-exceeded'

export interface ConnectorImportStore {
  issueGrant(command: ConnectorImportGrantCommand): Promise<
    | Readonly<{ status: 'created'; operationId: string; importBatchId: string }>
    | Readonly<{ status: 'replayed'; operationId: string; importBatchId: string }>
    | Readonly<{ status: 'conflict' }>
    | Readonly<{ status: 'closed' }>
  >
  beginCapture(command: ConnectorCaptureReservation): Promise<
    | Readonly<{
        status: 'pending'
        artifactId: string
        importBatchId: string
        retentionUntil: string
      }>
    | Readonly<{ status: 'replayed'; receipt: ConnectorCaptureReceipt }>
    | Readonly<{ status: 'rejected'; reason: ConnectorCaptureRejection }>
  >
  commitCapture(command: ConnectorCaptureCommit): Promise<
    | Readonly<{ status: 'committed' | 'replayed'; receipt: ConnectorCaptureReceipt }>
    | Readonly<{ status: 'rejected'; reason: 'invalid-grant' | 'operation-conflict' }>
  >
}

import { z } from 'zod'

import { uuidSchema } from '../../primitives.js'
import { providerKeySchema } from '../../providers/index.js'
import {
  accountFingerprintSchema,
  exactPublicOriginSchema,
  opaqueConnectorTokenSchema,
  revisionSchema,
  sha256Schema,
  transferCommandRejectionSchema,
} from '../contract-primitives.js'

export const connectorCaptureManifestV2Schema = z.object({
  manifestId: uuidSchema,
  manifestDigest: sha256Schema,
  sourceRevision: z.string().min(1).max(512),
  observedAt: z.iso.datetime({ offset: true }),
  capturedAt: z.iso.datetime({ offset: true }),
  chunkCount: z.number().int().min(1).max(1_000),
  listCount: z.number().int().nonnegative().max(10_000),
  itemCount: z.number().int().nonnegative().max(100_000),
  byteCount: z.number().int().min(2).max(134_217_728),
}).strict()

export const connectorImportGrantRequestV2Schema = z.object({
  schemaVersion: z.literal('connector-import-grant-request.v2'),
  commandId: uuidSchema,
  operationId: uuidSchema,
  connectionId: uuidSchema,
  expectedConnectionRevision: revisionSchema,
  providerKey: providerKeySchema,
  accountFingerprint: accountFingerprintSchema,
  installationId: uuidSchema,
  placeOrigin: exactPublicOriginSchema,
  manifest: connectorCaptureManifestV2Schema,
}).strict()

export const connectorImportGrantV2Schema = z.object({
  schemaVersion: z.literal('connector-import-grant.v2'),
  grantId: uuidSchema,
  operationId: uuidSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  accountFingerprint: accountFingerprintSchema,
  installationId: uuidSchema,
  operation: z.literal('import-saved-library'),
  token: opaqueConnectorTokenSchema,
  placeOrigin: exactPublicOriginSchema,
  manifest: connectorCaptureManifestV2Schema,
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  limits: z.object({
    maximumChunks: z.number().int().min(1).max(1_000),
    maximumItems: z.number().int().nonnegative().max(100_000),
    maximumBytes: z.number().int().min(1_024).max(134_217_728),
    maximumChunkBytes: z.number().int().min(1_024).max(4_194_304),
  }).strict(),
}).strict().superRefine((grant, context) => {
  if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiry must follow issuance' })
  }
  if (
    grant.manifest.chunkCount > grant.limits.maximumChunks ||
    grant.manifest.itemCount > grant.limits.maximumItems ||
    grant.manifest.byteCount > grant.limits.maximumBytes ||
    grant.limits.maximumChunkBytes > grant.limits.maximumBytes
  ) context.addIssue({ code: 'custom', path: ['limits'], message: 'manifest exceeds grant limits' })
})

export const connectorImportGrantResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('connector-import-grant-result.v2'), outcome: z.literal('accepted'),
    commandId: uuidSchema, status: z.literal('applied'),
    grant: connectorImportGrantV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('connector-import-grant-result.v2'), outcome: z.literal('rejected'),
    commandId: uuidSchema, rejection: transferCommandRejectionSchema,
  }).strict(),
])

const connectorSnapshotObservedItemV2Schema = z.object({
  sourceItemId: z.string().min(1).max(512),
  providerPlaceId: z.string().min(1).max(512).nullable(),
  observedName: z.string().min(1).max(300),
  observedAddress: z.string().min(1).max(500).nullable(),
  observedCategory: z.string().min(1).max(300).nullable(),
  observedLocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().nullable(),
  sourcePosition: z.number().int().nonnegative(),
}).strict()

export const connectorCaptureChunkPayloadV2Schema = z.object({
  lists: z.array(z.object({
    sourceListId: z.string().min(1).max(512),
    observedName: z.string().min(1).max(200),
    sourcePosition: z.number().int().nonnegative(),
    items: z.array(connectorSnapshotObservedItemV2Schema).max(1_000),
  }).strict()).max(100),
}).strict()

export const connectorCaptureChunkV2Schema = z.object({
  schemaVersion: z.literal('connector-capture-chunk.v2'),
  operationId: uuidSchema,
  manifestId: uuidSchema,
  sequence: z.number().int().nonnegative().max(999),
  itemCount: z.number().int().nonnegative().max(10_000),
  byteCount: z.number().int().min(2).max(4_194_304),
  checksum: sha256Schema,
  payload: z.string().min(2).max(4_194_304),
}).strict()

export const connectorCaptureChunkReceiptV2Schema = z.object({
  schemaVersion: z.literal('connector-capture-chunk-receipt.v2'),
  outcome: z.enum(['recorded', 'replayed']),
  operationId: uuidSchema,
  manifestId: uuidSchema,
  acceptedSequence: z.number().int().nonnegative().max(999),
  nextSequence: z.number().int().nonnegative().max(1_000),
  receivedChunks: z.number().int().nonnegative().max(1_000),
  receivedItems: z.number().int().nonnegative().max(100_000),
  receivedBytes: z.number().int().nonnegative().max(134_217_728),
}).strict()

export const connectorCaptureManifestStatusV2Schema = z.object({
  schemaVersion: z.literal('connector-capture-manifest-status.v2'),
  operationId: uuidSchema,
  manifestId: uuidSchema,
  state: z.enum(['receiving', 'completed', 'cancelled', 'expired']),
  recordedSequences: z.array(z.number().int().nonnegative().max(999)).max(1_000),
  nextSequence: z.number().int().nonnegative().max(1_000),
  snapshotId: uuidSchema.nullable(),
  snapshotVersion: revisionSchema.nullable(),
}).strict()

export const connectorCaptureCompleteRequestV2Schema = z.object({
  schemaVersion: z.literal('connector-capture-complete-request.v2'),
  operationId: uuidSchema,
  manifest: connectorCaptureManifestV2Schema,
}).strict()

export const connectorCaptureCompleteResultV2Schema = z.object({
  schemaVersion: z.literal('connector-capture-complete-result.v2'),
  outcome: z.enum(['completed', 'replayed', 'incomplete']),
  operationId: uuidSchema,
  manifestId: uuidSchema,
  missingSequences: z.array(z.number().int().nonnegative().max(999)).max(1_000),
  snapshotId: uuidSchema.nullable(),
  snapshotVersion: revisionSchema.nullable(),
}).strict()


export function connectorCaptureManifestDigestInputV2(input: Readonly<{
  operationId: string
  connectionId: string
  providerKey: string
  accountFingerprint: string
  installationId: string
  manifest: Omit<ConnectorCaptureManifestV2, 'manifestDigest'>
  chunks: readonly Readonly<{
    sequence: number
    itemCount: number
    byteCount: number
    checksum: string
  }>[]
}>): string {
  return JSON.stringify({
    operationId: input.operationId,
    connectionId: input.connectionId,
    providerKey: input.providerKey,
    accountFingerprint: input.accountFingerprint,
    installationId: input.installationId,
    manifest: {
      ...input.manifest,
      observedAt: new Date(input.manifest.observedAt).toISOString(),
      capturedAt: new Date(input.manifest.capturedAt).toISOString(),
    },
    chunks: [...input.chunks].sort((left, right) => left.sequence - right.sequence),
  })
}


export type ConnectorCaptureManifestV2 = z.infer<typeof connectorCaptureManifestV2Schema>
export type ConnectorImportGrantRequestV2 = z.infer<typeof connectorImportGrantRequestV2Schema>
export type ConnectorImportGrantV2 = z.infer<typeof connectorImportGrantV2Schema>
export type ConnectorImportGrantResultV2 = z.infer<typeof connectorImportGrantResultV2Schema>
export type ConnectorCaptureChunkV2 = z.infer<typeof connectorCaptureChunkV2Schema>
export type ConnectorCaptureChunkPayloadV2 = z.infer<typeof connectorCaptureChunkPayloadV2Schema>
export type ConnectorCaptureChunkReceiptV2 = z.infer<typeof connectorCaptureChunkReceiptV2Schema>
export type ConnectorCaptureManifestStatusV2 = z.infer<typeof connectorCaptureManifestStatusV2Schema>
export type ConnectorCaptureCompleteRequestV2 = z.infer<typeof connectorCaptureCompleteRequestV2Schema>
export type ConnectorCaptureCompleteResultV2 = z.infer<typeof connectorCaptureCompleteResultV2Schema>

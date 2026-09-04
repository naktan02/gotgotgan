import { z } from 'zod'

import { uuidSchema } from '../../primitives.js'
import { providerKeySchema } from '../../providers/index.js'
import { labelSchema, revisionSchema, transferCommandRejectionSchema } from '../contract-primitives.js'

export const outboundTransferStateV2Schema = z.enum([
  'draft',
  'blocked',
  'approved',
  'applying',
  'completed',
  'failed',
  'cancelled',
])

export const outboundTargetSelectionV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new-list'), name: labelSchema }).strict(),
  z.object({
    kind: z.literal('existing-list'),
    targetListId: z.string().min(1).max(512),
  }).strict(),
])

export const outboundPlaceSelectionV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({
    kind: z.literal('places'),
    placeIds: z.array(uuidSchema).min(1).max(500),
  }).strict().superRefine((selection, context) => {
    if (new Set(selection.placeIds).size !== selection.placeIds.length) {
      context.addIssue({ code: 'custom', path: ['placeIds'], message: 'placeIds must be unique' })
    }
  }),
])

const outboundTransferCommandBase = z.object({
  schemaVersion: z.literal('outbound-transfer-command.v2'),
  commandId: uuidSchema,
})

export const outboundTransferCommandRequestV2Schema = z.discriminatedUnion('kind', [
  outboundTransferCommandBase.extend({
    kind: z.literal('preview'),
    transferId: uuidSchema,
    connectionId: uuidSchema,
    collectionId: uuidSchema,
    expectedCollectionRevision: revisionSchema,
    selection: outboundPlaceSelectionV2Schema,
    target: outboundTargetSelectionV2Schema,
  }).strict(),
  outboundTransferCommandBase.extend({
    kind: z.literal('approve'),
    transferId: uuidSchema,
    expectedTransferRevision: revisionSchema,
  }).strict(),
])

export const outboundTransferV2Schema = z.object({
  schemaVersion: z.literal('outbound-transfer.v2'),
  transferId: uuidSchema,
  transferRevision: revisionSchema,
  providerKey: providerKeySchema,
  connectionId: uuidSchema,
  collectionId: uuidSchema,
  collectionRevision: revisionSchema,
  target: outboundTargetSelectionV2Schema,
  targetObservationRevision: revisionSchema.nullable(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: outboundTransferStateV2Schema,
  selection: outboundPlaceSelectionV2Schema,
  itemCount: z.number().int().nonnegative(),
  preview: z.object({
    availability: z.enum(['available', 'unavailable']),
    addCount: z.number().int().nonnegative().nullable(),
    alreadyPresentCount: z.number().int().nonnegative().nullable(),
    unresolvedCount: z.number().int().nonnegative().nullable(),
    unsupportedCount: z.number().int().nonnegative().nullable(),
    items: z.array(z.object({
      placeId: uuidSchema,
      status: z.enum(['add', 'already-present', 'unresolved', 'unsupported', 'unknown']),
      targetProviderPlaceId: z.string().min(1).max(512).nullable(),
    }).strict().superRefine((item, context) => {
      const resolved = item.status === 'add' || item.status === 'already-present'
      if (resolved !== (item.targetProviderPlaceId !== null)) {
        context.addIssue({ code: 'custom', path: ['targetProviderPlaceId'],
          message: 'resolved items require the provider target identity' })
      }
    })).max(500),
  }).strict(),
  approval: z.object({
    eligible: z.boolean(),
    reason: z.enum([
      'target-adapter-unavailable',
      'connection-not-ready',
      'preview-has-unresolved-items',
      'already-decided',
      'apply-failed',
    ]).nullable(),
  }).strict(),
  approvalReceipt: z.object({
    commandId: uuidSchema,
    planDigest: z.string().regex(/^[a-f0-9]{64}$/),
    approvedAt: z.iso.datetime({ offset: true }),
  }).strict().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const outboundTransferIdentifierParamsV2Schema = z.object({ transferId: uuidSchema }).strict()

export const providerConnectionIdentifierParamsV2Schema = z.object({
  connectionId: uuidSchema,
}).strict()

export const providerTargetListV2Schema = z.object({
  targetListId: z.string().min(1).max(512),
  name: z.string().min(1).max(200),
  itemCount: z.number().int().nonnegative().nullable(),
}).strict()

export const providerTargetListProjectionV2Schema = z.object({
  schemaVersion: z.literal('provider-target-list-projection.v2'),
  connectionId: uuidSchema,
  availability: z.enum(['available', 'unavailable']),
  reason: z.enum(['connection-not-ready', 'target-adapter-unavailable']).nullable(),
  targetObservationRevision: revisionSchema.nullable(),
  items: z.array(providerTargetListV2Schema).max(500),
}).strict()

export const outboundTransferCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('outbound-transfer-command-result.v2'),
    outcome: z.literal('accepted'),
    commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']),
    transfer: outboundTransferV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('outbound-transfer-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: transferCommandRejectionSchema,
  }).strict(),
])

export type OutboundTransferCommandRequestV2 = z.infer<typeof outboundTransferCommandRequestV2Schema>
export type OutboundTransferCommandResultV2 = z.infer<typeof outboundTransferCommandResultV2Schema>
export type OutboundTransferV2 = z.infer<typeof outboundTransferV2Schema>
export type ProviderTargetListV2 = z.infer<typeof providerTargetListV2Schema>

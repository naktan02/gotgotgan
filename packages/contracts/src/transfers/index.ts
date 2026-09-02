import { z } from 'zod'

import { uuidSchema } from '../primitives.js'
import { providerKeySchema } from '../providers/index.js'

const revisionSchema = z.string().min(1).max(512)
const cursorSchema = z.string().min(1).max(2_048)
const labelSchema = z.string().trim().min(1).max(120)

export const providerAuthMethodSchema = z.enum([
  'browser-session',
  'managed-profile',
  'oauth',
  'account-export',
  'manual-file',
])
export const providerConnectionStateV2Schema = z.enum([
  'action-required',
  'ready',
  'revoked',
])
export const transferAvailabilitySchema = z.enum([
  'available',
  'integration-gated',
  'unavailable',
])

export const providerCapabilityV2Schema = z.object({
  providerKey: providerKeySchema,
  displayName: z.string().min(1).max(40),
  connections: z.object({
    availability: transferAvailabilitySchema,
    multipleAccounts: z.literal(true),
    authMethods: z.array(providerAuthMethodSchema).max(5),
  }).strict(),
  importSavedPlaces: z.object({
    availability: transferAvailabilitySchema,
    reason: z.enum(['source-adapter-unavailable']).optional(),
  }).strict(),
  exportCollections: z.object({
    availability: transferAvailabilitySchema,
    reason: z.enum(['target-adapter-unavailable']).optional(),
  }).strict(),
}).strict()

export const providerCapabilityListV2Schema = z.object({
  schemaVersion: z.literal('provider-capability-list.v2'),
  items: z.array(providerCapabilityV2Schema).length(3),
}).strict()

export const providerConnectionV2Schema = z.object({
  schemaVersion: z.literal('provider-connection.v2'),
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  label: labelSchema,
  authMethod: providerAuthMethodSchema,
  state: providerConnectionStateV2Schema,
  connectionRevision: revisionSchema,
  lastVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
  actionRequired: z.enum([
    'complete-authorization',
    'reauthorize',
  ]).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const providerConnectionListV2Schema = z.object({
  schemaVersion: z.literal('provider-connection-list.v2'),
  items: z.array(providerConnectionV2Schema).max(50),
}).strict()

const providerConnectionCommandBase = z.object({
  schemaVersion: z.literal('provider-connection-command.v2'),
  commandId: uuidSchema,
})

export const providerConnectionCommandRequestV2Schema = z.discriminatedUnion('kind', [
  providerConnectionCommandBase.extend({
    kind: z.literal('create'),
    connectionId: uuidSchema,
    providerKey: providerKeySchema,
    label: labelSchema,
    authMethod: providerAuthMethodSchema,
  }).strict(),
  providerConnectionCommandBase.extend({
    kind: z.literal('rename'),
    connectionId: uuidSchema,
    expectedConnectionRevision: revisionSchema,
    label: labelSchema,
  }).strict(),
  providerConnectionCommandBase.extend({
    kind: z.literal('request-reauthorization'),
    connectionId: uuidSchema,
    expectedConnectionRevision: revisionSchema,
  }).strict(),
  providerConnectionCommandBase.extend({
    kind: z.literal('revoke'),
    connectionId: uuidSchema,
    expectedConnectionRevision: revisionSchema,
  }).strict(),
])

export const transferCommandRejectionCodeV2Schema = z.enum([
  'not-found',
  'command-id-reused',
  'revision-conflict',
  'snapshot-changed',
  'collection-changed',
  'target-observation-changed',
  'invalid-selection',
  'connection-not-ready',
  'target-unavailable',
  'not-approvable',
])

const transferCommandRejectionSchema = z.object({
  code: transferCommandRejectionCodeV2Schema,
}).strict()

export const providerConnectionCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('provider-connection-command-result.v2'),
    outcome: z.literal('accepted'),
    commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']),
    connection: providerConnectionV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('provider-connection-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: transferCommandRejectionSchema,
  }).strict(),
])

export const sourceSnapshotListQueryV2Schema = z.object({
  connectionId: uuidSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const sourceSnapshotSummaryV2Schema = z.object({
  snapshotId: uuidSchema,
  snapshotVersion: revisionSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  sourceRevision: z.string().min(1).max(512),
  listCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  unresolvedItemCount: z.number().int().nonnegative(),
  observedAt: z.iso.datetime({ offset: true }),
  capturedAt: z.iso.datetime({ offset: true }),
}).strict()

export const sourceSnapshotListV2Schema = z.object({
  schemaVersion: z.literal('source-snapshot-list.v2'),
  items: z.array(sourceSnapshotSummaryV2Schema).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const sourceSnapshotDetailV2Schema = sourceSnapshotSummaryV2Schema.extend({
  schemaVersion: z.literal('source-snapshot-detail.v2'),
  lists: z.array(z.object({
    sourceListId: z.string().min(1).max(512),
    observedName: z.string().min(1).max(200),
    sourcePosition: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
    unresolvedItemCount: z.number().int().nonnegative(),
    items: z.array(z.object({
      sourceItemId: z.string().min(1).max(512),
      providerPlaceId: z.string().min(1).max(512).nullable(),
      observedName: z.string().min(1).max(300),
      observedAddress: z.string().min(1).max(500).nullable(),
      observedCategory: z.string().min(1).max(300).nullable(),
      observedLocation: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }).strict().nullable(),
      match: z.discriminatedUnion('status', [
        z.object({ status: z.literal('matched'), placeId: uuidSchema }).strict(),
        z.object({
          status: z.literal('unresolved'),
          reason: z.enum(['missing-identity', 'ambiguous', 'retired']),
        }).strict(),
      ]),
      sourcePosition: z.number().int().nonnegative(),
    }).strict()).max(500),
  }).strict()).max(50),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.lists.reduce((count, list) => count + list.items.length, 0) > 10_000) {
    context.addIssue({ code: 'custom', path: ['lists'], message: 'snapshot item limit exceeded' })
  }
})

export const sourceSnapshotIdentifierParamsV2Schema = z.object({
  snapshotId: uuidSchema,
}).strict()

export const importPlanTargetV2Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new'),
    collectionId: uuidSchema,
    name: labelSchema,
  }).strict(),
  z.object({
    kind: z.literal('existing'),
    collectionId: uuidSchema,
    expectedCollectionRevision: revisionSchema,
  }).strict(),
])

export const importPlanStateV2Schema = z.enum([
  'draft',
  'applying',
  'completed',
  'blocked',
])

const importPlanCommandBase = z.object({
  schemaVersion: z.literal('import-plan-command.v2'),
  commandId: uuidSchema,
})

export const importPlanCommandRequestV2Schema = z.discriminatedUnion('kind', [
  importPlanCommandBase.extend({
    kind: z.literal('create'),
    planId: uuidSchema,
    snapshotId: uuidSchema,
    expectedSnapshotVersion: revisionSchema,
    mappings: z.array(z.object({
      sourceListId: z.string().min(1).max(512),
      target: importPlanTargetV2Schema,
    }).strict()).min(1).max(50),
  }).strict(),
  importPlanCommandBase.extend({
    kind: z.literal('decide-item'),
    planId: uuidSchema,
    expectedPlanRevision: revisionSchema,
    sourceListId: z.string().min(1).max(512),
    sourceItemId: z.string().min(1).max(512),
    decision: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('link'), placeId: uuidSchema }).strict(),
      z.object({ kind: z.literal('skip') }).strict(),
    ]),
  }).strict(),
  importPlanCommandBase.extend({
    kind: z.literal('approve'),
    planId: uuidSchema,
    expectedPlanRevision: revisionSchema,
  }).strict(),
])

export const importPlanV2Schema = z.object({
  schemaVersion: z.literal('import-plan.v2'),
  planId: uuidSchema,
  planRevision: revisionSchema,
  snapshotId: uuidSchema,
  snapshotVersion: revisionSchema,
  providerKey: providerKeySchema,
  connectionId: uuidSchema,
  state: importPlanStateV2Schema,
  approval: z.object({
    eligible: z.boolean(),
    reason: z.enum(['unresolved-places', 'already-decided', 'materialization-rejected']).nullable(),
  }).strict(),
  mappings: z.array(z.object({
    sourceListId: z.string().min(1).max(512),
    observedName: z.string().min(1).max(200),
    sourcePosition: z.number().int().nonnegative(),
    target: importPlanTargetV2Schema,
    itemCount: z.number().int().nonnegative(),
    unresolvedItemCount: z.number().int().nonnegative(),
    preview: z.object({
      addCount: z.number().int().nonnegative(),
      alreadyPresentCount: z.number().int().nonnegative(),
      unresolvedCount: z.number().int().nonnegative(),
      skippedCount: z.number().int().nonnegative(),
      items: z.array(z.object({
        sourceItemId: z.string().min(1).max(512),
        providerPlaceId: z.string().min(1).max(512).nullable(),
        observedName: z.string().min(1).max(300),
        observedAddress: z.string().min(1).max(500).nullable(),
        placeId: uuidSchema.nullable(),
        status: z.enum(['add', 'already-present', 'unresolved', 'skipped']),
        decision: z.enum(['snapshot-match', 'link', 'skip', 'none']),
      }).strict()).max(500),
    }).strict(),
    materialization: z.object({
      state: z.enum(['pending', 'applied', 'rejected']),
      collectionRevision: revisionSchema.nullable(),
      rejectionCode: z.string().min(1).max(120).nullable(),
    }).strict(),
  }).strict()).min(1).max(50),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const importPlanIdentifierParamsV2Schema = z.object({ planId: uuidSchema }).strict()

export const importPlanCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('import-plan-command-result.v2'),
    outcome: z.literal('accepted'),
    commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']),
    plan: importPlanV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('import-plan-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: transferCommandRejectionSchema,
  }).strict(),
])

export const outboundTransferStateV2Schema = z.enum([
  'draft',
  'blocked',
  'approved',
  'applying',
  'completed',
  'failed',
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
    }).strict()).max(500),
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

export type ProviderCapabilityV2 = z.infer<typeof providerCapabilityV2Schema>
export type ProviderConnectionV2 = z.infer<typeof providerConnectionV2Schema>
export type ProviderConnectionCommandRequestV2 = z.infer<typeof providerConnectionCommandRequestV2Schema>
export type ProviderConnectionCommandResultV2 = z.infer<typeof providerConnectionCommandResultV2Schema>
export type ProviderTargetListV2 = z.infer<typeof providerTargetListV2Schema>
export type SourceSnapshotDetailV2 = z.infer<typeof sourceSnapshotDetailV2Schema>
export type SourceSnapshotListV2 = z.infer<typeof sourceSnapshotListV2Schema>
export type ImportPlanCommandRequestV2 = z.infer<typeof importPlanCommandRequestV2Schema>
export type ImportPlanCommandResultV2 = z.infer<typeof importPlanCommandResultV2Schema>
export type ImportPlanV2 = z.infer<typeof importPlanV2Schema>
export type OutboundTransferCommandRequestV2 = z.infer<typeof outboundTransferCommandRequestV2Schema>
export type OutboundTransferCommandResultV2 = z.infer<typeof outboundTransferCommandResultV2Schema>
export type OutboundTransferV2 = z.infer<typeof outboundTransferV2Schema>
export type TransferCommandRejectionCodeV2 = z.infer<typeof transferCommandRejectionCodeV2Schema>

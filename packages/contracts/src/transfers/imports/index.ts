import { z } from 'zod'

import { uuidSchema } from '../../primitives.js'
import { providerKeySchema } from '../../providers/index.js'
import {
  cursorSchema,
  labelSchema,
  revisionSchema,
  transferCommandRejectionSchema,
} from '../contract-primitives.js'

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
  'cancelled',
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

const importPlanPreviewItemV3Schema = z.object({
  sourceItemId: z.string().min(1).max(512),
  providerPlaceId: z.string().min(1).max(512).nullable(),
  observedName: z.string().min(1).max(300),
  observedAddress: z.string().min(1).max(500).nullable(),
  placeId: uuidSchema.nullable(),
  status: z.enum(['add', 'already-present', 'unresolved', 'skipped']),
  decision: z.enum(['snapshot-match', 'policy-create', 'link', 'skip', 'none']),
}).strict().superRefine((item, context) => {
  const resolved = item.status === 'add' || item.status === 'already-present'
  const valid = item.decision === 'policy-create'
    ? item.status === 'add' && item.placeId === null && item.providerPlaceId !== null
    : resolved
      ? item.placeId !== null && (item.decision === 'snapshot-match' || item.decision === 'link')
      : item.status === 'unresolved'
        ? item.placeId === null && item.decision === 'none'
        : item.placeId === null && item.decision === 'skip'
  if (!valid) {
    context.addIssue({ code: 'custom', message: 'preview item decision shape is invalid' })
  }
})

const importPlanCommandBaseV3 = z.object({
  schemaVersion: z.literal('import-plan-command.v3'),
  commandId: uuidSchema,
})

export const importPlanCommandRequestV3Schema = z.discriminatedUnion('kind', [
  importPlanCommandBaseV3.extend({
    kind: z.literal('create'),
    planId: uuidSchema,
    snapshotId: uuidSchema,
    expectedSnapshotVersion: revisionSchema,
    mappings: z.array(z.object({
      sourceListId: z.string().min(1).max(512),
      target: importPlanTargetV2Schema,
    }).strict()).min(1).max(50),
  }).strict(),
  importPlanCommandBaseV3.extend({
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
  importPlanCommandBaseV3.extend({
    kind: z.literal('approve'),
    planId: uuidSchema,
    expectedPlanRevision: revisionSchema,
  }).strict(),
])

export const importPlanV3Schema = z.object({
  schemaVersion: z.literal('import-plan.v3'),
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
      items: z.array(importPlanPreviewItemV3Schema).max(500),
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

export const importPlanIdentifierParamsV3Schema = z.object({ planId: uuidSchema }).strict()

export const importPlanCommandResultV3Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('import-plan-command-result.v3'),
    outcome: z.literal('accepted'),
    commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']),
    plan: importPlanV3Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('import-plan-command-result.v3'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: transferCommandRejectionSchema,
  }).strict(),
])


export type SourceSnapshotDetailV2 = z.infer<typeof sourceSnapshotDetailV2Schema>
export type SourceSnapshotListV2 = z.infer<typeof sourceSnapshotListV2Schema>
export type ImportPlanCommandRequestV2 = z.infer<typeof importPlanCommandRequestV2Schema>
export type ImportPlanCommandResultV2 = z.infer<typeof importPlanCommandResultV2Schema>
export type ImportPlanV2 = z.infer<typeof importPlanV2Schema>
export type ImportPlanCommandRequestV3 = z.infer<typeof importPlanCommandRequestV3Schema>
export type ImportPlanCommandResultV3 = z.infer<typeof importPlanCommandResultV3Schema>
export type ImportPlanV3 = z.infer<typeof importPlanV3Schema>

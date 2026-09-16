import { z } from 'zod'

import { uuidSchema } from '../../primitives.js'
import { providerKeySchema } from '../../providers/index.js'
import { cursorSchema, revisionSchema, transferCommandRejectionSchema } from '../contract-primitives.js'

export const transferOperationKindV2Schema = z.enum([
  'import-capture',
  'import-materialization',
  'outbound-transfer',
  'account-erasure',
])

export const transferOperationStateV2Schema = z.enum([
  'queued',
  'running',
  'retry-scheduled',
  'action-required',
  'partial-failure',
  'outcome-unknown',
  'completed',
  'cancelled',
  'failed',
])

export const transferOperationStageV2Schema = z.enum([
  'awaiting-connector',
  'receiving-chunks',
  'validating-manifest',
  'snapshot-recorded',
  'preview-approved',
  'queued-for-materialization',
  'materializing',
  'library-completed',
  'authorizing-execution',
  'executing-provider-write',
  'reconciling',
  'externally-completed',
  'retention-review',
  'purging',
  'erasure-completed',
])

export const transferOperationAllowedActionV2Schema = z.enum([
  'retry', 'resume', 'cancel', 'reconcile',
])

export const transferOperationV2Schema = z.object({
  schemaVersion: z.literal('transfer-operation.v2'),
  operationId: uuidSchema,
  kind: transferOperationKindV2Schema,
  providerKey: providerKeySchema.nullable(),
  connectionId: uuidSchema.nullable(),
  accountLabel: z.string().min(1).max(120).nullable(),
  resource: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('snapshot'), snapshotId: uuidSchema }).strict(),
    z.object({ kind: z.literal('import-plan'), planId: uuidSchema }).strict(),
    z.object({ kind: z.literal('outbound-transfer'), transferId: uuidSchema }).strict(),
    z.object({ kind: z.literal('membership-erasure') }).strict(),
  ]),
  stage: transferOperationStageV2Schema,
  state: transferOperationStateV2Schema,
  progress: z.object({
    total: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    outcomeUnknown: z.number().int().nonnegative(),
  }).strict(),
  operationRevision: revisionSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  actionRequired: z.enum([
    'reauth-required', 'mfa-required', 'captcha-required', 'consent-required',
    'retention-review-required', 'operator-approval-required',
  ]).nullable(),
  allowedActions: z.array(transferOperationAllowedActionV2Schema).max(4),
  lastError: z.object({ code: z.string().min(1).max(120), retryable: z.boolean() })
    .strict().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict().superRefine((operation, context) => {
  const progress = operation.progress
  if (
    progress.processed > progress.total || progress.applied > progress.processed ||
    progress.failed + progress.outcomeUnknown > progress.processed ||
    progress.applied + progress.failed + progress.outcomeUnknown > progress.processed
  ) context.addIssue({ code: 'custom', path: ['progress'], message: 'invalid progress counters' })
})

export const transferOperationListQueryV2Schema = z.object({
  kind: transferOperationKindV2Schema.optional(),
  state: transferOperationStateV2Schema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const transferOperationListV2Schema = z.object({
  schemaVersion: z.literal('transfer-operation-list.v2'),
  items: z.array(transferOperationV2Schema).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const transferOperationSummaryV2Schema = z.object({
  schemaVersion: z.literal('transfer-operation-summary.v2'),
  activeCount: z.number().int().nonnegative(),
  attentionCount: z.number().int().nonnegative(),
  actionRequiredCount: z.number().int().nonnegative(),
  outcomeUnknownCount: z.number().int().nonnegative(),
  latest: z.array(transferOperationV2Schema).max(5),
}).strict()

export const transferOperationItemStatusV2Schema = z.enum([
  'pending', 'applied', 'already-present', 'failed', 'outcome-unknown',
  'present', 'absent', 'skipped',
])

export const transferOperationItemV2Schema = z.object({
  itemKey: z.string().min(1).max(512),
  placeId: uuidSchema.nullable(),
  targetReference: z.string().min(1).max(512).nullable(),
  status: transferOperationItemStatusV2Schema,
  code: z.string().min(1).max(120).nullable(),
  retryable: z.boolean().nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const transferOperationItemQueryV2Schema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict()

export const transferOperationItemPageV2Schema = z.object({
  schemaVersion: z.literal('transfer-operation-item-page.v2'),
  operationId: uuidSchema,
  items: z.array(transferOperationItemV2Schema).max(200),
  nextCursor: cursorSchema.optional(),
}).strict()

export const transferOperationIdentifierParamsV2Schema = z.object({
  operationId: uuidSchema,
}).strict()

export const transferOperationCommandRequestV2Schema = z.object({
  schemaVersion: z.literal('transfer-operation-command.v2'),
  commandId: uuidSchema,
  operationId: uuidSchema,
  expectedOperationRevision: revisionSchema,
  action: transferOperationAllowedActionV2Schema,
}).strict()

export const transferOperationCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('transfer-operation-command-result.v2'),
    outcome: z.literal('accepted'),
    commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']),
    operation: transferOperationV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('transfer-operation-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: transferCommandRejectionSchema,
  }).strict(),
])

export const accountErasureReviewCommandRequestV2Schema = z.object({
  schemaVersion: z.literal('account-erasure-review-command.v2'),
  commandId: uuidSchema,
}).strict()

const accountErasureReviewPlanV2Schema = z.object({
  physicalDeletionPerformed: z.literal(false),
  retentionDisposition: z.literal('operator-review-required'),
  recordCounts: z.object({
    providerConnections: z.number().int().nonnegative(),
    sourceSnapshots: z.number().int().nonnegative(),
    importPlans: z.number().int().nonnegative(),
    outboundTransfers: z.number().int().nonnegative(),
    transferOperations: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export const accountErasureReviewCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('account-erasure-review-command-result.v2'),
    outcome: z.literal('accepted'), commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']), operation: transferOperationV2Schema,
    plan: accountErasureReviewPlanV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('account-erasure-review-command-result.v2'),
    outcome: z.literal('rejected'), commandId: uuidSchema,
    rejection: transferCommandRejectionSchema,
  }).strict(),
])


export type TransferOperationV2 = z.infer<typeof transferOperationV2Schema>
export type TransferOperationListV2 = z.infer<typeof transferOperationListV2Schema>
export type TransferOperationSummaryV2 = z.infer<typeof transferOperationSummaryV2Schema>
export type TransferOperationItemPageV2 = z.infer<typeof transferOperationItemPageV2Schema>
export type TransferOperationCommandRequestV2 = z.infer<typeof transferOperationCommandRequestV2Schema>
export type TransferOperationCommandResultV2 = z.infer<typeof transferOperationCommandResultV2Schema>
export type AccountErasureReviewCommandRequestV2 = z.infer<
  typeof accountErasureReviewCommandRequestV2Schema
>
export type AccountErasureReviewCommandResultV2 = z.infer<
  typeof accountErasureReviewCommandResultV2Schema
>

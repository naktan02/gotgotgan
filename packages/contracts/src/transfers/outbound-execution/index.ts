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
import { outboundTargetSelectionV2Schema } from '../outbound/index.js'
import { transferOperationV2Schema } from '../operations/index.js'

export const outboundExecutionGrantRequestV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-grant-request.v2'),
  commandId: uuidSchema,
  transferId: uuidSchema,
  expectedTransferRevision: revisionSchema,
  installationId: uuidSchema,
  accountFingerprint: accountFingerprintSchema,
  placeOrigin: exactPublicOriginSchema,
}).strict()

export const outboundExecutionManifestV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-manifest.v2'),
  operationId: uuidSchema,
  transferId: uuidSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  accountFingerprint: accountFingerprintSchema,
  collectionId: uuidSchema,
  collectionRevision: revisionSchema,
  targetObservationRevision: revisionSchema,
  target: outboundTargetSelectionV2Schema,
  planDigest: sha256Schema,
  items: z.array(z.object({
    itemKey: uuidSchema,
    placeId: uuidSchema,
    targetProviderPlaceId: z.string().min(1).max(512),
    action: z.enum(['add', 'already-present']),
    sourcePosition: z.number().int().nonnegative(),
  }).strict()).max(100_000),
}).strict()

export const outboundExecutionGrantV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-grant.v2'),
  grantId: uuidSchema,
  operationId: uuidSchema,
  transferId: uuidSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  accountFingerprint: accountFingerprintSchema,
  installationId: uuidSchema,
  operation: z.literal('export-saved-library'),
  planDigest: sha256Schema,
  token: opaqueConnectorTokenSchema,
  placeOrigin: exactPublicOriginSchema,
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  limits: z.object({
    maximumItems: z.number().int().min(1).max(100_000),
    maximumBytes: z.number().int().min(1_024).max(134_217_728),
    maximumBatches: z.number().int().min(1).max(1_000),
  }).strict(),
  manifest: outboundExecutionManifestV2Schema,
}).strict().superRefine((grant, context) => {
  if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiry must follow issuance' })
  }
})

export const outboundExecutionGrantResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('outbound-execution-grant-result.v2'), outcome: z.literal('accepted'),
    commandId: uuidSchema, status: z.literal('applied'),
    grant: outboundExecutionGrantV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('outbound-execution-grant-result.v2'), outcome: z.literal('rejected'),
    commandId: uuidSchema, rejection: transferCommandRejectionSchema,
  }).strict(),
])

export const outboundExecutionConsumeRequestV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-consume-request.v2'),
  grantId: uuidSchema,
  operationId: uuidSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  accountFingerprint: accountFingerprintSchema,
  installationId: uuidSchema,
  planDigest: sha256Schema,
  sourceOrigin: exactPublicOriginSchema,
  itemCount: z.number().int().nonnegative().max(100_000),
  byteCount: z.number().int().nonnegative().max(134_217_728),
  batchCount: z.number().int().min(1).max(1_000),
  batchSize: z.number().int().min(1).max(500),
}).strict()

export const outboundExecutionAuthorizationReceiptV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-authorization-receipt.v2'),
  status: z.enum(['consumed', 'replayed']),
  grantId: uuidSchema,
  receiptReference: uuidSchema,
  /** Opaque execution-session capability. Send only as `Authorization: PlaceConnector <token>`. */
  receiptToken: opaqueConnectorTokenSchema,
  operationId: uuidSchema,
  transferId: uuidSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  accountFingerprint: accountFingerprintSchema,
  installationId: uuidSchema,
  planDigest: sha256Schema,
  batchSize: z.number().int().min(1).max(500),
  authorizedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  reconciliationExpiresAt: z.iso.datetime({ offset: true }),
  limits: outboundExecutionGrantV2Schema.shape.limits,
}).strict().superRefine((receipt, context) => {
  const authorizedAt = Date.parse(receipt.authorizedAt)
  const expiresAt = Date.parse(receipt.expiresAt)
  const reconciliationExpiresAt = Date.parse(receipt.reconciliationExpiresAt)
  if (!(authorizedAt < expiresAt)) {
    context.addIssue({
      code: 'custom', path: ['expiresAt'], message: 'write expiry must follow authorization',
    })
  }
  if (!(expiresAt <= reconciliationExpiresAt)) {
    context.addIssue({
      code: 'custom', path: ['reconciliationExpiresAt'],
      message: 'reconciliation expiry cannot precede write expiry',
    })
  }
})

export const outboundExecutionAttemptV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-attempt.v2'),
  operationId: uuidSchema,
  receiptReference: uuidSchema,
  attemptId: uuidSchema,
  phase: z.enum(['create-target-list', 'add-items']),
  targetListId: z.string().min(1).max(512).nullable(),
  sequence: z.number().int().nonnegative().max(999),
  final: z.boolean(),
  outcome: z.enum(['completed', 'partial', 'outcome-unknown']),
  reconciliationReference: z.string().min(1).max(512).nullable(),
  problem: z.object({
    code: z.string().min(1).max(120),
    retryable: z.boolean(),
    actionRequired: z.enum([
      'reauth-required', 'mfa-required', 'captcha-required', 'consent-required',
    ]).nullable(),
  }).strict().nullable().default(null),
  items: z.array(z.object({
    itemKey: uuidSchema,
    targetReference: z.string().min(1).max(512).nullable(),
    status: z.enum(['applied', 'already-present', 'failed', 'outcome-unknown']),
    code: z.string().min(1).max(120).nullable(),
    retryable: z.boolean().nullable(),
    reconciliationReference: z.string().min(1).max(512).nullable(),
  }).strict().superRefine((item, context) => {
    if (item.status === 'failed' && (item.code === null || item.retryable === null)) {
      context.addIssue({ code: 'custom', message: 'failed items require code and retryable' })
    }
    if (item.status === 'outcome-unknown' && item.reconciliationReference === null) {
      context.addIssue({ code: 'custom', message: 'unknown items require reconciliation reference' })
    }
    if (
      (item.status === 'applied' || item.status === 'already-present') &&
      (item.code !== null || item.retryable !== null || item.reconciliationReference !== null)
    ) context.addIssue({ code: 'custom', message: 'successful items cannot carry failure metadata' })
  })).max(500),
}).strict().superRefine((attempt, context) => {
  if ((attempt.outcome === 'outcome-unknown') !== (attempt.reconciliationReference !== null)) {
    context.addIssue({
      code: 'custom', path: ['reconciliationReference'],
      message: 'top-level outcome unknown requires exactly one reconciliation reference',
    })
  }
  if (attempt.phase === 'add-items' && attempt.targetListId === null) {
    context.addIssue({
      code: 'custom', path: ['targetListId'], message: 'item writes require a target list',
    })
  }
  if ((attempt.outcome === 'partial') !== (attempt.problem !== null)) {
    context.addIssue({
      code: 'custom', path: ['problem'], message: 'partial outcomes require exactly one problem',
    })
  }
  if (attempt.problem !== null && attempt.problem.actionRequired !== null && attempt.problem.retryable) {
    context.addIssue({
      code: 'custom', path: ['problem', 'retryable'], message: 'action-required problems are not retryable',
    })
  }
  if (attempt.items.some((item) => item.status === 'outcome-unknown' &&
    item.reconciliationReference !== attempt.reconciliationReference)) {
    context.addIssue({
      code: 'custom', path: ['items'], message: 'unknown items must use the attempt reconciliation reference',
    })
  }
})

export const outboundExecutionAttemptIntentV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-attempt-intent.v2'),
  operationId: uuidSchema,
  receiptReference: uuidSchema,
  attemptId: uuidSchema,
  phase: z.enum(['create-target-list', 'add-items']),
  targetListId: z.string().min(1).max(512).nullable(),
  sequence: z.number().int().nonnegative().max(999),
  final: z.boolean(),
  reconciliationReference: z.string().min(1).max(512),
  items: z.array(z.object({
    itemKey: uuidSchema,
    targetReference: z.string().min(1).max(512),
  }).strict()).max(500),
}).strict().superRefine((intent, context) => {
  if (intent.phase === 'create-target-list' && intent.items.length !== 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'target creation has no item batch' })
  }
  if (intent.phase === 'add-items' && (intent.targetListId === null || intent.items.length === 0)) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'item writes require a target and batch' })
  }
})

export const outboundExecutionAttemptIntentReceiptV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-attempt-intent-receipt.v2'),
  outcome: z.enum(['recorded', 'replayed']),
  operationId: uuidSchema,
  attemptId: uuidSchema,
}).strict()

export const outboundExecutionAttemptReceiptV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-attempt-receipt.v2'),
  outcome: z.enum(['recorded', 'replayed']),
  operation: transferOperationV2Schema,
}).strict()

const outboundExecutionReconciliationBaseV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-reconciliation.v2'),
  reconciliationId: uuidSchema,
  operationId: uuidSchema,
  receiptReference: uuidSchema,
  attemptId: uuidSchema,
  targetListId: z.string().min(1).max(512).nullable(),
  reconciliationReference: z.string().min(1).max(512),
  items: z.array(z.object({
    itemKey: uuidSchema,
    status: z.enum(['present', 'absent', 'unknown']),
    targetReference: z.string().min(1).max(512).nullable(),
  }).strict()).max(500),
}).strict()

export const outboundExecutionReconciliationV2Schema = z.discriminatedUnion('phase', [
  outboundExecutionReconciliationBaseV2Schema.extend({
    phase: z.literal('create-target-list'),
    outcome: z.enum(['resolved-completed', 'still-unknown']),
  }).strict(),
  outboundExecutionReconciliationBaseV2Schema.extend({
    phase: z.literal('add-items'),
    outcome: z.enum(['resolved-completed', 'resolved-partial', 'still-unknown']),
  }).strict(),
])

export const outboundExecutionReconciliationReceiptV2Schema = z.object({
  schemaVersion: z.literal('outbound-execution-reconciliation-receipt.v2'),
  outcome: z.enum(['recorded', 'replayed']),
  operation: transferOperationV2Schema,
}).strict()


function stableTransferValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableTransferValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableTransferValue(nested)]))
  }
  return value
}

export function outboundExecutionPlanDigestInputV2(
  manifest: Omit<OutboundExecutionManifestV2, 'schemaVersion' | 'planDigest'>,
): string {
  return JSON.stringify(stableTransferValue(manifest))
}


export type OutboundExecutionGrantRequestV2 = z.infer<typeof outboundExecutionGrantRequestV2Schema>
export type OutboundExecutionManifestV2 = z.infer<typeof outboundExecutionManifestV2Schema>
export type OutboundExecutionGrantV2 = z.infer<typeof outboundExecutionGrantV2Schema>
export type OutboundExecutionGrantResultV2 = z.infer<typeof outboundExecutionGrantResultV2Schema>
export type OutboundExecutionConsumeRequestV2 = z.infer<typeof outboundExecutionConsumeRequestV2Schema>
export type OutboundExecutionAuthorizationReceiptV2 = z.infer<
  typeof outboundExecutionAuthorizationReceiptV2Schema
>
export type OutboundExecutionAttemptV2 = z.infer<typeof outboundExecutionAttemptV2Schema>
export type OutboundExecutionAttemptIntentV2 = z.infer<
  typeof outboundExecutionAttemptIntentV2Schema
>
export type OutboundExecutionAttemptIntentReceiptV2 = z.infer<
  typeof outboundExecutionAttemptIntentReceiptV2Schema
>
export type OutboundExecutionAttemptReceiptV2 = z.infer<
  typeof outboundExecutionAttemptReceiptV2Schema
>
export type OutboundExecutionReconciliationV2 = z.infer<
  typeof outboundExecutionReconciliationV2Schema
>
export type OutboundExecutionReconciliationReceiptV2 = z.infer<
  typeof outboundExecutionReconciliationReceiptV2Schema
>

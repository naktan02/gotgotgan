import { z } from 'zod'

import { providerKeySchema } from '../../providers/index.js'
import { uuidSchema } from '../../primitives.js'
import { revisionSchema } from '../contract-primitives.js'

export const oneShotImportMethodV1Schema = z.enum(['shared-links', 'remote-browser'])

export const importAcquisitionItemStateV1Schema = z.enum([
  'pending',
  'fetching',
  'ready',
  'duplicate',
  'invalid',
  'unavailable',
  'rate-limited',
  'failed',
])

const safeFailureCodeSchema = z.enum([
  'invalid-url',
  'unsupported-host',
  'redirect-policy-denied',
  'share-not-found',
  'share-not-readable',
  'provider-rate-limited',
  'provider-unavailable',
  'request-timeout',
  'response-too-large',
  'source-limit-exceeded',
  'provider-parser-drift',
  'remote-browser-integration-gated',
  'session-expired',
  'session-cleanup-required',
])

export const importAcquisitionItemV1Schema = z.object({
  entryId: uuidSchema,
  position: z.number().int().min(0).max(19),
  state: importAcquisitionItemStateV1Schema,
  sourceListId: z.string().min(1).max(512).optional(),
  name: z.string().min(1).max(200).optional(),
  itemCount: z.number().int().nonnegative().max(500).optional(),
  duplicateOfEntryId: uuidSchema.optional(),
  failure: z.object({
    code: safeFailureCodeSchema,
    retryable: z.boolean(),
  }).strict().optional(),
}).strict().superRefine((item, context) => {
  if (item.state === 'ready' && (
    item.sourceListId === undefined || item.name === undefined || item.itemCount === undefined
  )) context.addIssue({ code: 'custom', message: 'ready item requires list metadata' })
  if (item.state === 'duplicate' && item.duplicateOfEntryId === undefined) {
    context.addIssue({ code: 'custom', message: 'duplicate item requires its winner' })
  }
  if (['invalid', 'unavailable', 'rate-limited', 'failed'].includes(item.state) &&
    item.failure === undefined) {
    context.addIssue({ code: 'custom', message: 'failed item requires a safe failure' })
  }
})

export const importAcquisitionV1Schema = z.object({
  schemaVersion: z.literal('import-acquisition.v1'),
  acquisitionId: uuidSchema,
  acquisitionRevision: revisionSchema,
  importSourceId: uuidSchema,
  providerKey: providerKeySchema,
  method: oneShotImportMethodV1Schema,
  state: z.enum(['processing', 'ready', 'partial', 'failed', 'cancelled', 'expired']),
  items: z.array(importAcquisitionItemV1Schema).max(20),
  progress: z.object({
    total: z.number().int().nonnegative().max(20),
    processed: z.number().int().nonnegative().max(20),
    ready: z.number().int().nonnegative().max(20),
    failed: z.number().int().nonnegative().max(20),
  }).strict(),
  snapshot: z.object({
    snapshotId: uuidSchema,
    snapshotVersion: revisionSchema,
  }).strict().optional(),
  interaction: z.object({
    state: z.enum(['integration-gated', 'ready', 'opened', 'closed']),
    launchUrl: z.string().max(2_048).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  }).strict().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((acquisition, context) => {
  if (acquisition.progress.processed > acquisition.progress.total ||
    acquisition.progress.ready + acquisition.progress.failed > acquisition.progress.processed) {
    context.addIssue({ code: 'custom', path: ['progress'], message: 'invalid progress counts' })
  }
  if (acquisition.items.length !== acquisition.progress.total) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'item count does not match progress' })
  }
  if (acquisition.snapshot !== undefined && acquisition.progress.ready === 0) {
    context.addIssue({ code: 'custom', path: ['snapshot'], message: 'snapshot requires ready lists' })
  }
  if (acquisition.method === 'shared-links' && acquisition.interaction !== undefined) {
    context.addIssue({ code: 'custom', path: ['interaction'], message: 'shared links have no interaction' })
  }
})

const sharedLinkInputSchema = z.object({
  entryId: uuidSchema,
  position: z.number().int().min(0).max(19),
  url: z.string().trim().min(1).max(2_048),
}).strict()

export const startImportAcquisitionV1Schema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal('start-import-acquisition.v1'),
    kind: z.literal('shared-links'),
    commandId: uuidSchema,
    acquisitionId: uuidSchema,
    importSourceId: uuidSchema,
    snapshotId: uuidSchema,
    providerKey: z.literal('naver'),
    links: z.array(sharedLinkInputSchema).min(1).max(20),
  }).strict().superRefine((command, context) => {
    if (new Set(command.links.map((link) => link.entryId)).size !== command.links.length) {
      context.addIssue({ code: 'custom', path: ['links'], message: 'entry identifiers must be unique' })
    }
    if (new Set(command.links.map((link) => link.position)).size !== command.links.length) {
      context.addIssue({ code: 'custom', path: ['links'], message: 'entry positions must be unique' })
    }
  }),
  z.object({
    schemaVersion: z.literal('start-import-acquisition.v1'),
    kind: z.literal('remote-browser'),
    commandId: uuidSchema,
    acquisitionId: uuidSchema,
    importSourceId: uuidSchema,
    providerKey: z.literal('naver'),
  }).strict(),
])

export const importAcquisitionCommandV1Schema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal('import-acquisition-command.v1'),
    kind: z.literal('cancel'),
    commandId: uuidSchema,
    acquisitionId: uuidSchema,
    expectedAcquisitionRevision: revisionSchema,
  }).strict(),
])

export const importAcquisitionCommandResultV1Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('import-acquisition-command-result.v1'),
    outcome: z.literal('accepted'),
    commandId: uuidSchema,
    status: z.enum(['applied', 'replayed']),
    acquisition: importAcquisitionV1Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('import-acquisition-command-result.v1'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: z.object({
      code: z.enum([
        'not-found', 'command-id-reused', 'revision-conflict', 'not-cancellable',
        'limit-exceeded',
      ]),
    }).strict(),
  }).strict(),
])

export const importAcquisitionIdentifierParamsV1Schema = z.object({
  acquisitionId: uuidSchema,
}).strict()

export type ImportAcquisitionV1 = z.infer<typeof importAcquisitionV1Schema>
export type StartImportAcquisitionV1 = z.infer<typeof startImportAcquisitionV1Schema>
export type ImportAcquisitionCommandV1 = z.infer<typeof importAcquisitionCommandV1Schema>
export type ImportAcquisitionCommandResultV1 = z.infer<typeof importAcquisitionCommandResultV1Schema>

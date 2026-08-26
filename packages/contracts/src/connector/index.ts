import { z } from 'zod'

import { uuidSchema } from '../http/content.js'
import { providerKeySchema } from '../search/index.js'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const opaqueGrantTokenSchema = z.string().min(32).max(8_192)
  .regex(/^[A-Za-z0-9._~-]+$/)

export const connectorBrowserKeySchema = z.enum([
  'chrome',
  'edge',
  'whale',
  'firefox',
  'safari',
  'chromium-other',
])

export const connectorOperationSchema = z.enum(['import-saved-library'])

export const connectorPublicOriginSchema = z.url().superRefine((value, context) => {
  const url = new URL(value)
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname)
  if (
    value !== url.origin ||
    url.username !== '' ||
    url.password !== '' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Connector origins must be exact public HTTPS or loopback HTTP origins.',
    })
  }
})

export const connectorGrantSchema = z.object({
  schemaVersion: z.literal('place-connector-grant.v1'),
  operationId: uuidSchema,
  providerKey: providerKeySchema,
  operation: connectorOperationSchema,
  idempotencyKey: uuidSchema,
  token: opaqueGrantTokenSchema,
  placeOrigin: connectorPublicOriginSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  limits: z.object({
    maximumItems: z.number().int().min(1).max(100_000),
    maximumBytes: z.number().int().min(1_024).max(134_217_728),
    maximumBatches: z.number().int().min(1).max(1_000),
    maximumBatchBytes: z.number().int().min(1_024).max(4_194_304),
  }).strict(),
}).strict().superRefine((grant, context) => {
  if (grant.limits.maximumBatchBytes > grant.limits.maximumBytes) {
    context.addIssue({
      code: 'custom',
      path: ['limits', 'maximumBatchBytes'],
      message: 'A connector batch cannot exceed the operation byte limit.',
    })
  }
})

const connectorMessageBaseSchema = z.object({
  channel: z.literal('place-connector'),
  requestId: uuidSchema,
})

export const connectorPageCommandSchema = z.discriminatedUnion('kind', [
  connectorMessageBaseSchema.extend({
    schemaVersion: z.literal('place-connector-command.v1'),
    kind: z.literal('probe'),
  }).strict(),
  connectorMessageBaseSchema.extend({
    schemaVersion: z.literal('place-connector-command.v1'),
    kind: z.literal('start-import'),
    grant: connectorGrantSchema,
  }).strict(),
  connectorMessageBaseSchema.extend({
    schemaVersion: z.literal('place-connector-command.v1'),
    kind: z.literal('cancel-import'),
    operationId: uuidSchema,
  }).strict(),
])

const connectorProgressSchema = z.object({
  phase: z.enum(['checking-session', 'collecting', 'submitting', 'finalizing']),
  discoveredItems: z.number().int().nonnegative().max(100_000),
  capturedItems: z.number().int().nonnegative().max(100_000),
  submittedItems: z.number().int().nonnegative().max(100_000),
  submittedBatches: z.number().int().nonnegative().max(1_000),
}).strict().refine(
  (progress) => progress.discoveredItems >= progress.capturedItems &&
    progress.capturedItems >= progress.submittedItems,
  { message: 'Connector progress counters must be monotonic.' },
)

export const connectorResultCodeSchema = z.enum([
  'completed',
  'cancelled',
  'reauth-required',
  'permission-denied',
  'provider-unavailable',
  'provider-drift',
  'invalid-request',
  'upload-rejected',
  'internal-failure',
])

export const connectorExtensionEventSchema = z.discriminatedUnion('kind', [
  connectorMessageBaseSchema.extend({
    schemaVersion: z.literal('place-connector-event.v1'),
    kind: z.literal('ready'),
    installationId: uuidSchema,
    browserKey: connectorBrowserKeySchema,
    supportedProviders: z.array(providerKeySchema).max(3),
  }).strict(),
  connectorMessageBaseSchema.extend({
    schemaVersion: z.literal('place-connector-event.v1'),
    kind: z.literal('progress'),
    operationId: uuidSchema,
    progress: connectorProgressSchema,
  }).strict(),
  connectorMessageBaseSchema.extend({
    schemaVersion: z.literal('place-connector-event.v1'),
    kind: z.literal('result'),
    operationId: uuidSchema.optional(),
    code: connectorResultCodeSchema,
    retryable: z.boolean(),
  }).strict(),
])

export const connectorCaptureBatchSchema = z.object({
  schemaVersion: z.literal('place-connector-capture-batch.v1'),
  operationId: uuidSchema,
  providerKey: providerKeySchema,
  sequence: z.number().int().nonnegative().max(999),
  final: z.boolean(),
  itemCount: z.number().int().nonnegative().max(500),
  contentType: z.literal('application/json'),
  payload: z.string().min(2).max(4_194_304),
  checksum: sha256Schema,
}).strict()

export const connectorCaptureReceiptSchema = z.object({
  schemaVersion: z.literal('place-connector-capture-receipt.v1'),
  operationId: uuidSchema,
  acceptedSequence: z.number().int().nonnegative().max(999),
  acceptedChecksum: sha256Schema,
  receivedItems: z.number().int().nonnegative().max(100_000),
  receivedBytes: z.number().int().nonnegative().max(134_217_728),
  importBatchId: uuidSchema,
}).strict()

export const connectorWireDocumentSchema = z.union([
  connectorGrantSchema,
  connectorPageCommandSchema,
  connectorExtensionEventSchema,
  connectorCaptureBatchSchema,
  connectorCaptureReceiptSchema,
])

export type ConnectorBrowserKey = z.infer<typeof connectorBrowserKeySchema>
export type ConnectorProviderKey = z.infer<typeof providerKeySchema>
export type ConnectorResultCode = z.infer<typeof connectorResultCodeSchema>
export type ConnectorGrant = z.infer<typeof connectorGrantSchema>
export type ConnectorPageCommand = z.infer<typeof connectorPageCommandSchema>
export type ConnectorExtensionEvent = z.infer<typeof connectorExtensionEventSchema>
export type ConnectorCaptureBatch = z.infer<typeof connectorCaptureBatchSchema>
export type ConnectorCaptureReceipt = z.infer<typeof connectorCaptureReceiptSchema>

import { z } from 'zod'

import { uuidSchema } from '../../primitives.js'
import { providerKeySchema } from '../../providers/index.js'
import {
  labelSchema,
  revisionSchema,
  transferCommandRejectionSchema,
} from '../contract-primitives.js'

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
  }).strict().superRefine((value, context) => {
    if (new Set(value.authMethods).size !== value.authMethods.length) {
      context.addIssue({ code: 'custom', path: ['authMethods'], message: 'auth methods must be unique' })
    }
    if (value.availability === 'available' && value.authMethods.length === 0) {
      context.addIssue({ code: 'custom', path: ['authMethods'], message: 'available connections require an auth method' })
    }
    if (value.availability !== 'available' && value.authMethods.length > 0) {
      context.addIssue({ code: 'custom', path: ['authMethods'], message: 'unavailable connections expose no auth methods' })
    }
  }),
  importSavedPlaces: z.object({
    availability: transferAvailabilitySchema,
    reason: z.enum(['source-adapter-unavailable']).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.availability === 'available') === (value.reason !== undefined)) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required exactly when unavailable' })
    }
  }),
  exportCollections: z.object({
    availability: transferAvailabilitySchema,
    reason: z.enum(['target-adapter-unavailable']).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.availability === 'available') === (value.reason !== undefined)) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required exactly when unavailable' })
    }
  }),
}).strict()

export const providerCapabilityListV2Schema = z.object({
  schemaVersion: z.literal('provider-capability-list.v2'),
  items: z.array(providerCapabilityV2Schema).length(3),
}).strict().superRefine((value, context) => {
  const actual = new Set(value.items.map((item) => item.providerKey))
  const expected = ['naver', 'google', 'kakao'] as const
  if (actual.size !== expected.length || expected.some((providerKey) => !actual.has(providerKey))) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'capabilities require NAVER, Google, and Kakao exactly once' })
  }
})

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

export type ProviderCapabilityV2 = z.infer<typeof providerCapabilityV2Schema>
export type ProviderConnectionV2 = z.infer<typeof providerConnectionV2Schema>
export type ProviderConnectionCommandRequestV2 = z.infer<typeof providerConnectionCommandRequestV2Schema>
export type ProviderConnectionCommandResultV2 = z.infer<typeof providerConnectionCommandResultV2Schema>

import { z } from 'zod'

import { uuidSchema } from '../primitives.js'

const reservedHandles = new Set([
  'admin', 'api', 'auth', 'library', 'people', 'search', 'settings', 'share', 'support', 'www',
])

export const publicProfileHandleSchema = z.string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/)
  .refine((handle) => !reservedHandles.has(handle), 'handle is reserved')

export const publicProfileDisplayNameSchema = z.string().trim().min(1).max(50)
export const publicProfileVisibilitySchema = z.enum(['hidden', 'public'])
export const publicProfileReportReasonSchema = z.enum([
  'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content',
])
export const publicProfileModerationStateSchema = z.enum(['allowed', 'withheld'])
export const publicProfileAllowReasonSchema = z.enum(['insufficient-evidence', 'appeal-accepted'])
export const publicProfileModerationReasonSchema = z.union([
  publicProfileReportReasonSchema,
  publicProfileAllowReasonSchema,
])

export const publicProfileHandleParamsSchema = z.object({
  handle: publicProfileHandleSchema,
}).strict()

export const publicProfileQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const publicProfileReportRequestSchema = z.object({
  reportId: uuidSchema,
  reason: publicProfileReportReasonSchema,
}).strict()

export const publicProfileReportResultSchema = z.object({
  schemaVersion: z.literal('public-profile-report-result.v1'),
  status: z.enum(['recorded', 'replayed', 'already-reported']),
}).strict()

export const publicProfileModerationRequestSchema = z.object({
  decisionId: uuidSchema,
  moderation: z.discriminatedUnion('state', [
    z.object({
      state: z.literal('withheld'),
      reason: publicProfileReportReasonSchema,
      expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
    }).strict(),
    z.object({
      state: z.literal('allowed'),
      reason: publicProfileAllowReasonSchema,
      expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
    }).strict(),
  ]),
}).strict()

export const publicProfileModerationRecordSchema = z.object({
  schemaVersion: z.literal('public-profile-moderation.v1'),
  handle: publicProfileHandleSchema,
  state: publicProfileModerationStateSchema,
  reason: publicProfileModerationReasonSchema.nullable(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict()

export const publicProfileModerationResultSchema = z.object({
  schemaVersion: z.literal('public-profile-moderation-result.v1'),
  status: z.enum(['applied', 'replayed']),
}).strict()

export const publicProfileReportQueueQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const publicProfileReportQueueSchema = z.object({
  schemaVersion: z.literal('public-profile-report-queue.v1'),
  reports: z.array(z.object({
    reportId: uuidSchema,
    handle: publicProfileHandleSchema,
    reason: publicProfileReportReasonSchema,
    reportedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  }).strict()).max(50),
  nextCursor: z.string().min(1).max(2_048).optional(),
}).strict()

export const publicProfileRecordSchema = z.object({
  schemaVersion: z.literal('public-profile-record.v1'),
  handle: publicProfileHandleSchema,
  displayName: publicProfileDisplayNameSchema,
  visibility: publicProfileVisibilitySchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const setPublicProfileRequestSchema = z.object({
  commandId: uuidSchema,
  profile: z.object({
    handle: publicProfileHandleSchema,
    displayName: publicProfileDisplayNameSchema,
    visibility: publicProfileVisibilitySchema,
    expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable().transform((value) => (
      value === null ? null : new Date(value).toISOString()
    )),
  }).strict(),
}).strict()

export const publicProfileCommandResultSchema = z.object({
  schemaVersion: z.literal('public-profile-command-result.v1'),
  status: z.enum(['applied', 'replayed']),
}).strict()

export const publicProfileProjectionSchema = z.object({
  schemaVersion: z.literal('public-profile.v1'),
  handle: publicProfileHandleSchema,
  displayName: publicProfileDisplayNameSchema,
  collections: z.array(z.object({
    publicationId: uuidSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(2_000).nullable(),
    placeCount: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime({ offset: true }),
  }).strict()).max(50),
  nextCursor: z.string().min(1).max(2_048).optional(),
}).strict()

export type PublicProfileRecord = z.infer<typeof publicProfileRecordSchema>
export type PublicProfileQuery = z.infer<typeof publicProfileQuerySchema>
export type PublicProfileProjection = z.infer<typeof publicProfileProjectionSchema>
export type SetPublicProfileRequest = z.infer<typeof setPublicProfileRequestSchema>
export type PublicProfileReportRequest = z.infer<typeof publicProfileReportRequestSchema>
export type PublicProfileReportResult = z.infer<typeof publicProfileReportResultSchema>
export type PublicProfileModerationRequest = z.infer<typeof publicProfileModerationRequestSchema>
export type PublicProfileModerationRecord = z.infer<typeof publicProfileModerationRecordSchema>
export type PublicProfileModerationResult = z.infer<typeof publicProfileModerationResultSchema>
export type PublicProfileReportQueue = z.infer<typeof publicProfileReportQueueSchema>

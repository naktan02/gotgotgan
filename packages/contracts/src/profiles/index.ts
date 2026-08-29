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

export const publicProfileHandleParamsSchema = z.object({
  handle: publicProfileHandleSchema,
}).strict()

export const publicProfileQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
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

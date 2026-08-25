import { z } from 'zod'

import { uuidSchema } from '../http/content.js'

export const placeReferenceSchema = z.discriminatedUnion('status', [
  z.object({
    schemaVersion: z.literal('place-reference.v1'),
    status: z.literal('available'),
    placeId: uuidSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('place-reference.v1'),
    status: z.literal('unavailable'),
  }).strict(),
  z.object({
    schemaVersion: z.literal('place-reference.v1'),
    status: z.literal('redacted'),
  }).strict(),
])

export type PlaceReference = z.infer<typeof placeReferenceSchema>

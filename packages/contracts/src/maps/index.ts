import { z } from 'zod'

import { mapLocationSchema, mapViewportSchema, uuidSchema } from '../primitives.js'

const taxonomy = z.object({ key: z.string().min(1).max(160), label: z.string().min(1).max(160) }).strict()

export const mapPlaceClassificationV3Schema = z.object({
  primaryTaxonomy: taxonomy,
  rootTaxonomy: taxonomy.nullable(),
}).strict().nullable()

export const mapPlaceFeatureV3Schema = z.object({
  kind: z.literal('place'),
  placeId: uuidSchema,
  label: z.string().min(1).max(300),
  location: mapLocationSchema,
  classification: mapPlaceClassificationV3Schema,
}).strict()

export const mapFeatureV3Schema = z.discriminatedUnion('kind', [
  mapPlaceFeatureV3Schema,
  z.object({
    kind: z.literal('cluster'),
    clusterId: z.string().min(1).max(160),
    count: z.number().int().min(2),
    location: mapLocationSchema,
    bounds: mapViewportSchema,
    coincidentPreview: z.object({
      places: z.array(mapPlaceFeatureV3Schema).min(1).max(20),
      remainingCount: z.number().int().nonnegative(),
    }).strict().nullable(),
  }).strict(),
]).superRefine((feature, context) => {
  if (feature.kind !== 'cluster' || feature.coincidentPreview === null) return
  const preview = feature.coincidentPreview
  if (preview.places.length + preview.remainingCount !== feature.count ||
      new Set(preview.places.map((place) => place.placeId)).size !== preview.places.length ||
      preview.places.some((place) => place.location.latitude !== feature.location.latitude ||
        place.location.longitude !== feature.location.longitude)) {
    context.addIssue({ code: 'custom', message: 'coincident preview must represent unique places at this coordinate with an exact remainder' })
  }
})

export type MapPlaceClassificationV3 = z.infer<typeof mapPlaceClassificationV3Schema>
export type MapPlaceFeatureV3 = z.infer<typeof mapPlaceFeatureV3Schema>
export type MapFeatureV3 = z.infer<typeof mapFeatureV3Schema>

import { z } from 'zod'

import {
  isNonEmptyMapViewport,
  mapLocationSchema,
  mapQueryViewportFields,
  mapQueryZoomSchema,
  mapViewportSchema,
  mapZoomSchema,
  uuidSchema,
} from '../primitives.js'
import {
  libraryAreaFacetKeySchema,
  libraryAreaKeysSchema,
  libraryPlaceStateSchema,
  libraryTagIdsSchema,
  libraryTagMatchSchema,
  libraryTaxonomyFacetKeySchema,
  libraryTaxonomyKeysSchema,
} from './contract-primitives.js'

const libraryMapViewportFields = {
  ...mapQueryViewportFields,
  zoom: mapQueryZoomSchema,
}

export const libraryMapQuerySchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('state'),
    state: libraryPlaceStateSchema.default('saved'),
    tagIds: libraryTagIdsSchema,
    tagMatch: libraryTagMatchSchema.default('all'),
    areaKeys: libraryAreaKeysSchema,
    taxonomyKeys: libraryTaxonomyKeysSchema,
    ...libraryMapViewportFields,
  }).strict(),
  z.object({
    scope: z.literal('collection'),
    collectionId: uuidSchema,
    ...libraryMapViewportFields,
  }).strict(),
]).refine(isNonEmptyMapViewport, 'map viewport must be non-empty')

const libraryMapScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('state'),
    state: libraryPlaceStateSchema,
    tagIds: z.array(uuidSchema).max(20),
    tagMatch: libraryTagMatchSchema,
    areaKeys: z.array(libraryAreaFacetKeySchema).max(10),
    taxonomyKeys: z.array(libraryTaxonomyFacetKeySchema).max(10),
  }).strict(),
  z.object({
    kind: z.literal('collection'),
    collectionId: uuidSchema,
  }).strict(),
])

const libraryMapFeatureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('place'),
    placeId: uuidSchema,
    label: z.string().min(1).max(300),
    location: mapLocationSchema,
  }).strict(),
  z.object({
    kind: z.literal('cluster'),
    clusterId: z.string().min(1).max(160),
    count: z.number().int().min(2),
    location: mapLocationSchema,
    bounds: mapViewportSchema,
  }).strict(),
])

export const libraryMapResponseSchema = z.object({
  schemaVersion: z.literal('library-map-projection.v1'),
  scope: libraryMapScopeSchema,
  viewport: z.object({
    bounds: mapViewportSchema,
    zoom: mapZoomSchema,
  }).strict(),
  features: z.array(libraryMapFeatureSchema).max(500),
  coverage: z.object({
    representedPlaceCount: z.number().int().nonnegative(),
    unprojectedPlaceCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }).strict(),
}).strict().superRefine((projection, context) => {
  const represented = projection.features.reduce((count, feature) => (
    count + (feature.kind === 'place' ? 1 : feature.count)
  ), 0)
  if (represented !== projection.coverage.representedPlaceCount) {
    context.addIssue({
      code: 'custom',
      path: ['coverage', 'representedPlaceCount'],
      message: 'representedPlaceCount must equal the places represented by all features',
    })
  }
  if (projection.coverage.complete !== (projection.coverage.unprojectedPlaceCount === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['coverage', 'complete'],
      message: 'complete must reflect whether the active scope has unprojected places',
    })
  }
})

export type LibraryMapQuery = z.infer<typeof libraryMapQuerySchema>
export type LibraryMapResponse = z.infer<typeof libraryMapResponseSchema>

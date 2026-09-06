import { z } from 'zod'

import { mapFeatureV3Schema } from '../maps/index.js'
import { uuidSchema } from '../primitives.js'
import {
  personalLibraryMapHttpQueryV2Schema, personalLibraryMapRequestV2Schema,
  personalLibraryMapResponseV2Schema,
} from './workspace.js'

export const personalLibraryMapRequestV3Schema = personalLibraryMapRequestV2Schema.safeExtend({
  selectedPlaceId: uuidSchema.optional(),
})
export const personalLibraryMapHttpQueryV3Schema = personalLibraryMapHttpQueryV2Schema.safeExtend({
  selectedPlaceId: uuidSchema.optional(),
})
export const personalLibraryMapResponseV3Schema = z.object({
  ...personalLibraryMapResponseV2Schema.shape,
  schemaVersion: z.literal('personal-library-map.v3'),
  features: z.array(mapFeatureV3Schema).max(500),
}).strict().superRefine((projection, context) => {
  const represented = projection.features.reduce((count, feature) => count + (feature.kind === 'place' ? 1 : feature.count), 0)
  if (represented !== projection.coverage.representedPlaceCount ||
      projection.coverage.complete !== (projection.coverage.unprojectedPlaceCount === 0)) {
    context.addIssue({ code: 'custom', message: 'map coverage must match represented and unprojected places' })
  }
  const identifiers = projection.features.map((feature) => feature.kind === 'place' ? feature.placeId : feature.clusterId)
  if (new Set(identifiers).size !== identifiers.length) {
    context.addIssue({ code: 'custom', message: 'map features must be unique' })
  }
})

export type PersonalLibraryMapRequestV3 = z.infer<typeof personalLibraryMapRequestV3Schema>
export type PersonalLibraryMapResponseV3 = z.infer<typeof personalLibraryMapResponseV3Schema>

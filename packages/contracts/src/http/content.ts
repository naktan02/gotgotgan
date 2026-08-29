import { z } from 'zod'

import { placeSummarySchema } from '../place-summary/index.js'
import { uuidSchema } from '../primitives.js'

export { uuidSchema } from '../primitives.js'
export const sharedVisibilitySchema = z.enum(['unlisted', 'public'])
export const visibilitySchema = z.enum(['private', 'unlisted', 'public'])

export const setPlacePreferencesCommandSchema = z.object({
  kind: z.literal('set-place-preferences'),
  placeId: uuidSchema,
  expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable().transform((value) => (
    value === null ? null : new Date(value).toISOString()
  )),
  saved: z.boolean(),
  wanted: z.boolean(),
  personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable(),
}).strict()

export const createCollectionCommandSchema = z.object({
  kind: z.literal('create-collection'),
  collectionId: uuidSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).optional(),
}).strict()

export const addCollectionPlaceCommandSchema = z.object({
  kind: z.literal('add-collection-place'),
  collectionId: uuidSchema,
  placeId: uuidSchema,
  position: z.number().int().min(0).max(1_000_000).optional(),
}).strict()

export const renameCollectionCommandSchema = z.object({
  kind: z.literal('rename-collection'),
  collectionId: uuidSchema,
  name: z.string().min(1).max(120),
}).strict()

export const setCollectionPublicationCommandSchema = z.object({
  kind: z.literal('set-collection-publication'),
  collectionId: uuidSchema,
  expectedUpdatedAt: z.iso.datetime({ offset: true }).transform((value) => (
    new Date(value).toISOString()
  )),
  visibility: visibilitySchema,
}).strict()

export const deleteCollectionCommandSchema = z.object({
  kind: z.literal('delete-collection'),
  collectionId: uuidSchema,
}).strict()

export const removeCollectionPlaceCommandSchema = z.object({
  kind: z.literal('remove-collection-place'),
  collectionId: uuidSchema,
  placeId: uuidSchema,
}).strict()

export const moveCollectionPlaceCommandSchema = z.object({
  kind: z.literal('move-collection-place'),
  collectionId: uuidSchema,
  placeId: uuidSchema,
  position: z.number().int().min(0).max(1_000_000),
}).strict()

export const createTagCommandSchema = z.object({
  kind: z.literal('create-tag'),
  tagId: uuidSchema,
  name: z.string().min(1).max(64),
}).strict()

export const tagPlaceCommandSchema = z.object({
  kind: z.literal('tag-place'),
  tagId: uuidSchema,
  placeId: uuidSchema,
}).strict()

export const renameTagCommandSchema = z.object({
  kind: z.literal('rename-tag'),
  tagId: uuidSchema,
  name: z.string().min(1).max(64),
}).strict()

export const deleteTagCommandSchema = z.object({
  kind: z.literal('delete-tag'),
  tagId: uuidSchema,
}).strict()

export const untagPlaceCommandSchema = z.object({
  kind: z.literal('untag-place'),
  tagId: uuidSchema,
  placeId: uuidSchema,
}).strict()

export const copyPublishedCollectionCommandSchema = z.object({
  kind: z.literal('copy-published-collection'),
  sourcePublicationId: uuidSchema,
  targetCollectionId: uuidSchema,
  targetName: z.string().min(1).max(120),
}).strict()

export const libraryCommandSchema = z.discriminatedUnion('kind', [
  setPlacePreferencesCommandSchema,
  createCollectionCommandSchema,
  addCollectionPlaceCommandSchema,
  renameCollectionCommandSchema,
  setCollectionPublicationCommandSchema,
  deleteCollectionCommandSchema,
  removeCollectionPlaceCommandSchema,
  moveCollectionPlaceCommandSchema,
  createTagCommandSchema,
  tagPlaceCommandSchema,
  renameTagCommandSchema,
  deleteTagCommandSchema,
  untagPlaceCommandSchema,
  copyPublishedCollectionCommandSchema,
])

export const libraryCommandRequestSchema = z.object({
  commandId: uuidSchema,
  command: libraryCommandSchema,
}).strict()

export const browserCreatePrivateCollectionCommandSchema = createCollectionCommandSchema

export const browserLibraryCommandSchema = z.discriminatedUnion('kind', [
  setPlacePreferencesCommandSchema,
  browserCreatePrivateCollectionCommandSchema,
  addCollectionPlaceCommandSchema,
  renameCollectionCommandSchema,
  setCollectionPublicationCommandSchema,
  deleteCollectionCommandSchema,
  removeCollectionPlaceCommandSchema,
  moveCollectionPlaceCommandSchema,
  createTagCommandSchema,
  tagPlaceCommandSchema,
  renameTagCommandSchema,
  deleteTagCommandSchema,
  untagPlaceCommandSchema,
  copyPublishedCollectionCommandSchema,
])

export const browserLibraryCommandRequestSchema = z.object({
  commandId: uuidSchema,
  command: browserLibraryCommandSchema,
}).strict()

export const visitRecordRequestSchema = z.object({
  id: uuidSchema,
  placeId: uuidSchema,
  visitedAt: z.iso.datetime(),
  evidence: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const browserVisitRecordRequestSchema = visitRecordRequestSchema.omit({ evidence: true })

const publicationFields = {
  visibility: visibilitySchema,
  publicationId: uuidSchema.optional(),
}

export const createNoteCommandSchema = z.object({
  kind: z.literal('create-note'),
  documentId: uuidSchema,
  body: z.string().min(1).max(2_000),
  placeId: uuidSchema,
  ...publicationFields,
}).strict()

export const updateNoteCommandSchema = z.object({
  kind: z.literal('update-note'),
  documentId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  body: z.string().min(1).max(2_000),
  placeId: uuidSchema,
  ...publicationFields,
}).strict()

export const createEntryCommandSchema = z.object({
  kind: z.literal('create-entry'),
  documentId: uuidSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(100_000),
  placeIds: z.array(uuidSchema).min(1).max(32),
  ...publicationFields,
}).strict()

export const updateEntryCommandSchema = z.object({
  kind: z.literal('update-entry'),
  documentId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(100_000),
  placeIds: z.array(uuidSchema).min(1).max(32),
  ...publicationFields,
}).strict()

export const writingCommandSchema = z.discriminatedUnion('kind', [
  createNoteCommandSchema,
  updateNoteCommandSchema,
  createEntryCommandSchema,
  updateEntryCommandSchema,
])

export const writingCommandRequestSchema = z.object({
  commandId: uuidSchema,
  command: writingCommandSchema,
}).strict()

export const browserCreatePrivateNoteCommandSchema = createNoteCommandSchema.omit({
  visibility: true,
  publicationId: true,
})

export const browserUpdatePrivateNoteCommandSchema = updateNoteCommandSchema.omit({
  visibility: true,
  publicationId: true,
})

export const browserPrivateNoteCommandRequestSchema = z.object({
  commandId: uuidSchema,
  command: z.discriminatedUnion('kind', [
    browserCreatePrivateNoteCommandSchema,
    browserUpdatePrivateNoteCommandSchema,
  ]),
}).strict()

export const publicationIdentifierParamsSchema = z.object({
  publicationId: uuidSchema,
}).strict()

export const placeIdentifierParamsSchema = z.object({ placeId: uuidSchema }).strict()

const publicationCursorSchema = z.string().min(1).max(2_048)
const longitudeSchema = z.coerce.number().finite().min(-180).max(180)
const latitudeSchema = z.coerce.number().finite().min(-90).max(90)
const validMapBounds = (bounds: Readonly<{
  west: number
  south: number
  east: number
  north: number
}>) => bounds.west < bounds.east && bounds.south < bounds.north

export const publishedCollectionQuerySchema = z.object({
  cursor: publicationCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
}).strict()

export const publishedCollectionMapQuerySchema = z.object({
  west: longitudeSchema,
  south: latitudeSchema,
  east: longitudeSchema,
  north: latitudeSchema,
  zoom: z.coerce.number().int().min(0).max(22),
}).strict().refine(validMapBounds, 'map bounds must have positive width and height')

export const publishedCollectionSchema = z.object({
  schemaVersion: z.literal('place-published-collection.v3'),
  publicationId: uuidSchema,
  visibility: sharedVisibilitySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  placeCount: z.number().int().nonnegative(),
  places: z.array(z.object({
    placeId: uuidSchema,
    position: z.number().int().nonnegative(),
    place: placeSummarySchema.nullable(),
  }).strict()).max(50),
  nextCursor: publicationCursorSchema.optional(),
  updatedAt: z.iso.datetime(),
}).strict()

const publishedCollectionMapBoundsSchema = z.object({
  west: longitudeSchema,
  south: latitudeSchema,
  east: longitudeSchema,
  north: latitudeSchema,
}).strict().refine(validMapBounds, 'map bounds must have positive width and height')

const publishedCollectionMapFeatureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('place'),
    placeId: uuidSchema,
    label: z.string().min(1).max(300),
    location: z.object({ latitude: latitudeSchema, longitude: longitudeSchema }).strict(),
  }).strict(),
  z.object({
    kind: z.literal('cluster'),
    clusterId: z.string().min(1).max(160),
    count: z.number().int().min(2),
    location: z.object({ latitude: latitudeSchema, longitude: longitudeSchema }).strict(),
    bounds: publishedCollectionMapBoundsSchema,
  }).strict(),
])

export const publishedCollectionMapSchema = z.object({
  schemaVersion: z.literal('place-published-collection-map.v1'),
  publicationId: uuidSchema,
  viewport: z.object({
    bounds: publishedCollectionMapBoundsSchema,
    zoom: z.number().int().min(0).max(22),
  }).strict(),
  features: z.array(publishedCollectionMapFeatureSchema).max(500),
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
      message: 'complete must reflect whether the publication has unprojected places',
    })
  }
})

export const publishedWritingSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal('place-published-writing.v1'),
    kind: z.literal('note'),
    publicationId: uuidSchema,
    visibility: sharedVisibilitySchema,
    body: z.string().min(1).max(2_000),
    placeIds: z.array(uuidSchema).length(1),
    updatedAt: z.iso.datetime(),
  }).strict(),
  z.object({
    schemaVersion: z.literal('place-published-writing.v1'),
    kind: z.literal('entry'),
    publicationId: uuidSchema,
    visibility: sharedVisibilitySchema,
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(100_000),
    placeIds: z.array(uuidSchema).min(1).max(32),
    updatedAt: z.iso.datetime(),
  }).strict(),
])

export type LibraryCommandRequest = z.infer<typeof libraryCommandRequestSchema>
export type BrowserLibraryCommandRequest = z.infer<typeof browserLibraryCommandRequestSchema>
export type VisitRecordRequest = z.infer<typeof visitRecordRequestSchema>
export type BrowserVisitRecordRequest = z.infer<typeof browserVisitRecordRequestSchema>
export type BrowserPrivateNoteCommandRequest = z.infer<typeof browserPrivateNoteCommandRequestSchema>
export type WritingCommandRequest = z.infer<typeof writingCommandRequestSchema>
export type PublishedCollection = z.infer<typeof publishedCollectionSchema>
export type PublishedCollectionQuery = z.infer<typeof publishedCollectionQuerySchema>
export type PublishedCollectionMapQuery = z.infer<typeof publishedCollectionMapQuerySchema>
export type PublishedCollectionMap = z.infer<typeof publishedCollectionMapSchema>
export type PublishedWriting = z.infer<typeof publishedWritingSchema>

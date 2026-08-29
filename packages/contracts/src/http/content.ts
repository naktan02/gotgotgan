import { z } from 'zod'

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

export const publishedCollectionSchema = z.object({
  schemaVersion: z.literal('place-published-collection.v1'),
  publicationId: uuidSchema,
  visibility: sharedVisibilitySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  places: z.array(z.object({
    placeId: uuidSchema,
    position: z.number().int().nonnegative(),
  }).strict()),
  updatedAt: z.iso.datetime(),
}).strict()

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
export type PublishedWriting = z.infer<typeof publishedWritingSchema>

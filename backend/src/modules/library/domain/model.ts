export const libraryVisibilities = ['private', 'unlisted', 'public'] as const
export type LibraryVisibility = (typeof libraryVisibilities)[number]

export type PlacePreferences = Readonly<{
  memberId: string
  placeId: string
  saved: boolean
  wanted: boolean
  personalRating: number | null
  updatedAt: string
}>

export type PublishedCollection = Readonly<{
  publicationId: string
  visibility: Exclude<LibraryVisibility, 'private'>
  name: string
  description: string | null
  places: readonly Readonly<{ placeId: string; position: number }>[]
  updatedAt: string
}>

export type MemberLibrary = Readonly<{
  places: readonly PlacePreferences[]
  collections: readonly Readonly<{
    collectionId: string
    name: string
    description: string | null
    visibility: LibraryVisibility
    publicationId: string | null
    places: readonly Readonly<{ placeId: string; position: number }>[]
    updatedAt: string
  }>[]
  tags: readonly Readonly<{
    tagId: string
    name: string
    placeIds: readonly string[]
  }>[]
}>

export type LibraryCommand =
  | Readonly<{
      kind: 'set-place-preferences'
      placeId: string
      saved: boolean
      wanted: boolean
      personalRating: number | null
    }>
  | Readonly<{
      kind: 'create-collection'
      collectionId: string
      name: string
      description?: string | undefined
      visibility: LibraryVisibility
      publicationId?: string | undefined
    }>
  | Readonly<{
      kind: 'add-collection-place'
      collectionId: string
      placeId: string
      position: number
    }>
  | Readonly<{ kind: 'create-tag'; tagId: string; name: string }>
  | Readonly<{ kind: 'tag-place'; tagId: string; placeId: string }>
  | Readonly<{
      kind: 'copy-published-collection'
      sourcePublicationId: string
      targetCollectionId: string
      targetName: string
    }>

export type LibraryAttempt = Readonly<{
  commandId: string
  memberId: string
  command: LibraryCommand
  occurredAt: string
  fingerprint: string
}>

export type LibraryCommandOutcome = Readonly<{
  status: 'applied' | 'replayed' | 'conflict' | 'not-found' | 'forbidden'
}>

export class InvalidLibraryCommandError extends Error {
  override readonly name = 'InvalidLibraryCommandError'
}

export class LibraryCommandConflictError extends Error {
  override readonly name = 'LibraryCommandConflictError'
}

function requireText(value: string, field: string, maximum: number): void {
  if (value.trim().length === 0 || value.length > maximum) {
    throw new InvalidLibraryCommandError(`${field} is invalid`)
  }
}

function requirePublication(visibility: LibraryVisibility, publicationId?: string): void {
  if ((visibility === 'private') !== (publicationId === undefined)) {
    throw new InvalidLibraryCommandError('publicationId is required only for shared visibility')
  }
}

export function assertLibraryCommand(command: LibraryCommand): void {
  if (command.kind === 'set-place-preferences') {
    if (command.personalRating !== null && (
      !Number.isFinite(command.personalRating) || command.personalRating < 0.1 ||
      command.personalRating > 5 || Math.round(command.personalRating * 10) !== command.personalRating * 10
    )) throw new InvalidLibraryCommandError('personalRating must be one decimal between 0.1 and 5.0')
    return
  }
  if (command.kind === 'create-collection') {
    requireText(command.name, 'name', 120)
    if (command.description !== undefined && command.description.length > 2_000) {
      throw new InvalidLibraryCommandError('description is too long')
    }
    requirePublication(command.visibility, command.publicationId)
    return
  }
  if (command.kind === 'add-collection-place') {
    if (!Number.isInteger(command.position) || command.position < 0) {
      throw new InvalidLibraryCommandError('position must be a non-negative integer')
    }
    return
  }
  if (command.kind === 'create-tag') {
    requireText(command.name, 'name', 64)
    return
  }
  if (command.kind === 'copy-published-collection') requireText(command.targetName, 'targetName', 120)
}

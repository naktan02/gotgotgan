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

export type LibraryCommand =
  | Readonly<{
      kind: 'set-place-preferences'
      placeId: string
      expectedUpdatedAt: string | null
      saved: boolean
      wanted: boolean
      personalRating: number | null
    }>
  | Readonly<{
      kind: 'create-collection'
      collectionId: string
      name: string
      description?: string | undefined
    }>
  | Readonly<{
      kind: 'add-collection-place'
      collectionId: string
      placeId: string
      position?: number | undefined
    }>
  | Readonly<{ kind: 'rename-collection'; collectionId: string; name: string }>
  | Readonly<{
      kind: 'set-collection-publication'
      collectionId: string
      expectedUpdatedAt: string
      visibility: LibraryVisibility
    }>
  | Readonly<{ kind: 'delete-collection'; collectionId: string }>
  | Readonly<{ kind: 'remove-collection-place'; collectionId: string; placeId: string }>
  | Readonly<{
      kind: 'move-collection-place'
      collectionId: string
      placeId: string
      position: number
    }>
  | Readonly<{ kind: 'create-tag'; tagId: string; name: string }>
  | Readonly<{ kind: 'tag-place'; tagId: string; placeId: string }>
  | Readonly<{ kind: 'rename-tag'; tagId: string; name: string }>
  | Readonly<{ kind: 'delete-tag'; tagId: string }>
  | Readonly<{ kind: 'untag-place'; tagId: string; placeId: string }>
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

export class LibraryPreferenceVersionConflictError extends Error {
  override readonly name = 'LibraryPreferenceVersionConflictError'
}

export class LibraryCollectionVersionConflictError extends Error {
  override readonly name = 'LibraryCollectionVersionConflictError'
}

function requireText(value: string, field: string, maximum: number): void {
  if (value.trim().length === 0 || value.length > maximum) {
    throw new InvalidLibraryCommandError(`${field} is invalid`)
  }
}

export function assertLibraryCommand(command: LibraryCommand): void {
  if (command.kind === 'set-place-preferences') {
    if (
      command.expectedUpdatedAt !== null &&
      Number.isNaN(Date.parse(command.expectedUpdatedAt))
    ) throw new InvalidLibraryCommandError('expectedUpdatedAt must be an ISO timestamp or null')
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
    return
  }
  if (command.kind === 'add-collection-place' || command.kind === 'move-collection-place') {
    if (command.position !== undefined && (
      !Number.isInteger(command.position) || command.position < 0 || command.position > 1_000_000
    )) {
      throw new InvalidLibraryCommandError('position must be an integer between 0 and 1000000')
    }
    if (command.kind === 'move-collection-place' && command.position === undefined) {
      throw new InvalidLibraryCommandError('position is required when moving a Collection Place')
    }
    return
  }
  if (command.kind === 'rename-collection') {
    requireText(command.name, 'name', 120)
    return
  }
  if (command.kind === 'set-collection-publication') {
    if (Number.isNaN(Date.parse(command.expectedUpdatedAt))) {
      throw new InvalidLibraryCommandError('expectedUpdatedAt must be an ISO timestamp')
    }
    return
  }
  if (command.kind === 'create-tag' || command.kind === 'rename-tag') {
    requireText(command.name, 'name', 64)
    return
  }
  if (command.kind === 'copy-published-collection') requireText(command.targetName, 'targetName', 120)
}

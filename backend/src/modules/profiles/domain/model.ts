export type PublicProfileVisibility = 'hidden' | 'public'

export type PublicProfileRecord = Readonly<{
  handle: string
  displayName: string
  visibility: PublicProfileVisibility
  createdAt: string
  updatedAt: string
}>

export type PublishedProfileOwner = PublicProfileRecord & Readonly<{
  ownerMemberId: string
  visibility: 'public'
}>

export type SetPublicProfileCommand = Readonly<{
  handle: string
  displayName: string
  visibility: PublicProfileVisibility
  expectedUpdatedAt: string | null
}>

export type PublicProfileAttempt = Readonly<{
  commandId: string
  memberId: string
  command: SetPublicProfileCommand
  fingerprint: string
  occurredAt: string
}>

export type PublicProfileOutcome = Readonly<{
  status: 'applied' | 'replayed' | 'conflict' | 'handle-unavailable' | 'handle-immutable' | 'version-conflict'
}>

export class InvalidPublicProfileError extends Error {
  override readonly name = 'InvalidPublicProfileError'
}

export class PublicProfileConflictError extends Error {
  override readonly name = 'PublicProfileConflictError'
}

export class PublicProfileHandleUnavailableError extends Error {
  override readonly name = 'PublicProfileHandleUnavailableError'
}

export class PublicProfileHandleImmutableError extends Error {
  override readonly name = 'PublicProfileHandleImmutableError'
}

export class PublicProfileVersionConflictError extends Error {
  override readonly name = 'PublicProfileVersionConflictError'
}

const reservedHandles = new Set([
  'admin', 'api', 'auth', 'library', 'people', 'search', 'settings', 'share', 'support', 'www',
])

export function assertSetPublicProfileCommand(command: SetPublicProfileCommand): void {
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(command.handle) ||
    command.handle.length < 3 || command.handle.length > 30 || reservedHandles.has(command.handle)
  ) throw new InvalidPublicProfileError('Public Handle is invalid')
  if (command.displayName.trim().length === 0 || command.displayName.length > 50) {
    throw new InvalidPublicProfileError('Public display name is invalid')
  }
  if (command.visibility !== 'hidden' && command.visibility !== 'public') {
    throw new InvalidPublicProfileError('Public Profile visibility is invalid')
  }
  if (command.expectedUpdatedAt !== null && Number.isNaN(Date.parse(command.expectedUpdatedAt))) {
    throw new InvalidPublicProfileError('Public Profile version is invalid')
  }
}

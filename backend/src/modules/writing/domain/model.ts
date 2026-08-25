export const writingVisibilities = ['private', 'unlisted', 'public'] as const
export type WritingVisibility = (typeof writingVisibilities)[number]

type Publication = Readonly<{
  visibility: WritingVisibility
  publicationId?: string | undefined
}>

export type WritingCommand =
  | (Readonly<{ kind: 'create-note'; documentId: string; body: string; placeId: string }> & Publication)
  | (Readonly<{
      kind: 'update-note'
      documentId: string
      expectedVersion: number
      body: string
      placeId: string
    }> & Publication)
  | (Readonly<{
      kind: 'create-entry'
      documentId: string
      title: string
      body: string
      placeIds: readonly string[]
    }> & Publication)
  | (Readonly<{
      kind: 'update-entry'
      documentId: string
      expectedVersion: number
      title: string
      body: string
      placeIds: readonly string[]
    }> & Publication)

export type WritingAttempt = Readonly<{
  commandId: string
  memberId: string
  command: WritingCommand
  occurredAt: string
  fingerprint: string
}>

export type WritingCommandOutcome =
  | Readonly<{ status: 'applied'; documentId: string; version: number }>
  | Readonly<{ status: 'replayed' | 'conflict' | 'not-found' | 'version-conflict' }>

export type PublishedWriting =
  | Readonly<{
      kind: 'note'
      publicationId: string
      visibility: Exclude<WritingVisibility, 'private'>
      body: string
      placeIds: readonly [string]
      updatedAt: string
    }>

  | Readonly<{
      kind: 'entry'
      publicationId: string
      visibility: Exclude<WritingVisibility, 'private'>
      title: string
      body: string
      placeIds: readonly string[]
      updatedAt: string
    }>

export type MemberWriting = Readonly<{
  documentId: string
  kind: 'note' | 'entry'
  title: string | null
  body: string
  visibility: WritingVisibility
  publicationId: string | null
  version: number
  placeIds: readonly string[]
  updatedAt: string
}>

export class InvalidWritingCommandError extends Error {
  override readonly name = 'InvalidWritingCommandError'
}

export class WritingCommandConflictError extends Error {
  override readonly name = 'WritingCommandConflictError'
}

function requireContent(value: string, field: string, maximum: number): void {
  if (value.trim().length === 0 || value.length > maximum) {
    throw new InvalidWritingCommandError(`${field} is invalid`)
  }
}

export function assertWritingCommand(command: WritingCommand): void {
  const note = command.kind === 'create-note' || command.kind === 'update-note'
  requireContent(command.body, 'body', note ? 2_000 : 100_000)
  if ((command.kind === 'update-note' || command.kind === 'update-entry') &&
    (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)) {
    throw new InvalidWritingCommandError('expectedVersion is invalid')
  }
  if ((command.visibility === 'private') !== (command.publicationId === undefined)) {
    throw new InvalidWritingCommandError('publicationId is required only for shared visibility')
  }
  if (command.kind === 'create-entry' || command.kind === 'update-entry') {
    requireContent(command.title, 'title', 200)
    if (command.placeIds.length === 0 || command.placeIds.length > 32 || new Set(command.placeIds).size !== command.placeIds.length) {
      throw new InvalidWritingCommandError('entry must link one to 32 distinct places')
    }
  }
}

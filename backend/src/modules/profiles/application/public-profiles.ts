import { createHash } from 'node:crypto'

import {
  assertSetPublicProfileCommand,
  PublicProfileConflictError,
  PublicProfileHandleImmutableError,
  PublicProfileHandleUnavailableError,
  PublicProfileVersionConflictError,
  type PublicProfileAttempt,
  type PublicProfileOutcome,
  type PublicProfileRecord,
  type PublishedProfileOwner,
  type SetPublicProfileCommand,
} from '../domain/model.js'

export type PublicCollectionDirectoryPage = Readonly<{
  items: readonly Readonly<{
    publicationId: string
    name: string
    description: string | null
    placeCount: number
    updatedAt: string
  }>[]
  nextCursor?: string
}>

export interface PublicProfileStore {
  apply(attempt: PublicProfileAttempt): Promise<PublicProfileOutcome>
  getCurrent(memberId: string): Promise<PublicProfileRecord | undefined>
  getPublished(handle: string): Promise<PublishedProfileOwner | undefined>
}

export type PublicCollectionDirectory = (input: Readonly<{
  ownerMemberId: string
  cursor?: string
  limit: number
}>) => Promise<PublicCollectionDirectoryPage>

export class InvalidPublicProfileCursorError extends Error {
  override readonly name = 'InvalidPublicProfileCursorError'
}

function fingerprint(memberId: string, command: SetPublicProfileCommand): string {
  return createHash('sha256').update(JSON.stringify({ memberId, command })).digest('hex')
}

export async function setPublicProfile(input: Readonly<{
  commandId: string
  memberId: string
  command: SetPublicProfileCommand
  occurredAt: string
  store: PublicProfileStore
}>) {
  assertSetPublicProfileCommand(input.command)
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('occurredAt must be an ISO timestamp')
  const outcome = await input.store.apply({
    commandId: input.commandId,
    memberId: input.memberId,
    command: input.command,
    occurredAt: input.occurredAt,
    fingerprint: fingerprint(input.memberId, input.command),
  })
  if (outcome.status === 'conflict') throw new PublicProfileConflictError('commandId is already used')
  if (outcome.status === 'handle-unavailable') throw new PublicProfileHandleUnavailableError('Public Handle is unavailable')
  if (outcome.status === 'handle-immutable') throw new PublicProfileHandleImmutableError('Public Handle cannot be changed')
  if (outcome.status === 'version-conflict') throw new PublicProfileVersionConflictError('Public Profile changed concurrently')
  return outcome
}

export async function readPublishedProfile(input: Readonly<{
  handle: string
  cursor?: string
  limit: number
  store: PublicProfileStore
  collections: PublicCollectionDirectory
}>) {
  const profile = await input.store.getPublished(input.handle)
  if (profile === undefined) return undefined
  const collections = await input.collections({
    ownerMemberId: profile.ownerMemberId,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit: input.limit,
  })
  return {
    schemaVersion: 'public-profile.v1' as const,
    handle: profile.handle,
    displayName: profile.displayName,
    collections: collections.items,
    ...(collections.nextCursor === undefined ? {} : { nextCursor: collections.nextCursor }),
  }
}

import { createHash } from 'node:crypto'

import {
  assertPublicProfileAppealReason,
  assertPublicProfileAppealResolutionCommand,
  InvalidPublicProfileAppealCursorError,
  PublicProfileAppealAlreadyResolvedError,
  PublicProfileAppealConflictError,
  PublicProfileAppealTargetChangedError,
  PublicProfileAppealTargetNotFoundError,
  type PendingPublicProfileAppeal,
  type PublicProfileAppealAttempt,
  type PublicProfileAppealOutcome,
  type PublicProfileAppealReason,
  type PublicProfileAppealResolutionAttempt,
  type PublicProfileAppealResolutionCommand,
  type PublicProfileAppealResolutionOutcome,
  type PublicProfileNoticeAcknowledgementOutcome,
  type PublicProfileOwnerNotice,
} from '../domain/appeals.js'
import {
  decodePublicProfileAppealQueueCursor,
  decodePublicProfileOwnerNoticeCursor,
  encodePublicProfileAppealQueueCursor,
  encodePublicProfileOwnerNoticeCursor,
  type PublicProfileAppealQueueCursor,
  type PublicProfileOwnerNoticeCursor,
} from './profile-appeal-cursor.js'

export interface PublicProfileAppealStore {
  listOwnerNotices(input: Readonly<{
    ownerMemberId: string
    before?: PublicProfileOwnerNoticeCursor
    limit: number
  }>): Promise<readonly PublicProfileOwnerNotice[]>
  acknowledgeOwnerNotice(input: Readonly<{
    ownerMemberId: string
    noticeId: string
    occurredAt: string
  }>): Promise<PublicProfileNoticeAcknowledgementOutcome>
  submitAppeal(attempt: PublicProfileAppealAttempt): Promise<PublicProfileAppealOutcome>
  listPendingAppeals(input: Readonly<{
    before?: PublicProfileAppealQueueCursor
    limit: number
  }>): Promise<readonly PendingPublicProfileAppeal[]>
  resolveAppeal(
    attempt: PublicProfileAppealResolutionAttempt,
  ): Promise<PublicProfileAppealResolutionOutcome>
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function assertListLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidPublicProfileAppealCursorError('Public Profile appeal query is invalid')
  }
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error('occurredAt must be an ISO timestamp')
}

export async function listPublicProfileOwnerNotices(input: Readonly<{
  ownerMemberId: string
  cursor?: string
  limit: number
  store: PublicProfileAppealStore
}>) {
  assertListLimit(input.limit)
  const before = input.cursor === undefined
    ? undefined
    : decodePublicProfileOwnerNoticeCursor(input.cursor, input.ownerMemberId)
  const rows = await input.store.listOwnerNotices({
    ownerMemberId: input.ownerMemberId,
    ...(before === undefined ? {} : { before }),
    limit: input.limit + 1,
  })
  const notices = rows.slice(0, input.limit)
  const last = notices.at(-1)
  return {
    schemaVersion: 'public-profile-moderation-notices.v1' as const,
    notices,
    ...(rows.length <= input.limit || last === undefined ? {} : {
      nextCursor: encodePublicProfileOwnerNoticeCursor({
        createdAt: last.createdAt,
        noticeId: last.noticeId,
      }, input.ownerMemberId),
    }),
  }
}

export async function acknowledgePublicProfileOwnerNotice(input: Readonly<{
  ownerMemberId: string
  noticeId: string
  occurredAt: string
  store: PublicProfileAppealStore
}>) {
  assertTimestamp(input.occurredAt)
  const outcome = await input.store.acknowledgeOwnerNotice(input)
  if (outcome.status === 'target-not-found') {
    throw new PublicProfileAppealTargetNotFoundError('Public Profile notice not found')
  }
  return outcome
}

export async function submitPublicProfileAppeal(input: Readonly<{
  appealId: string
  ownerMemberId: string
  noticeId: string
  reason: PublicProfileAppealReason
  occurredAt: string
  store: PublicProfileAppealStore
}>) {
  assertPublicProfileAppealReason(input.reason)
  assertTimestamp(input.occurredAt)
  const outcome = await input.store.submitAppeal({
    appealId: input.appealId,
    ownerMemberId: input.ownerMemberId,
    noticeId: input.noticeId,
    reason: input.reason,
    occurredAt: input.occurredAt,
    fingerprint: fingerprint({
      ownerMemberId: input.ownerMemberId,
      noticeId: input.noticeId,
      reason: input.reason,
    }),
  })
  if (outcome.status === 'conflict') {
    throw new PublicProfileAppealConflictError('appealId is already used')
  }
  if (outcome.status === 'target-not-found') {
    throw new PublicProfileAppealTargetNotFoundError('Public Profile moderation notice not found')
  }
  if (outcome.status === 'target-changed') {
    throw new PublicProfileAppealTargetChangedError('Public Profile moderation changed')
  }
  return outcome
}

export async function listPendingPublicProfileAppeals(input: Readonly<{
  cursor?: string
  limit: number
  store: PublicProfileAppealStore
}>) {
  assertListLimit(input.limit)
  const before = input.cursor === undefined
    ? undefined
    : decodePublicProfileAppealQueueCursor(input.cursor)
  const rows = await input.store.listPendingAppeals({
    ...(before === undefined ? {} : { before }),
    limit: input.limit + 1,
  })
  const appeals = rows.slice(0, input.limit)
  const last = appeals.at(-1)
  return {
    schemaVersion: 'public-profile-appeal-queue.v1' as const,
    appeals,
    ...(rows.length <= input.limit || last === undefined ? {} : {
      nextCursor: encodePublicProfileAppealQueueCursor({
        submittedAt: last.submittedAt,
        appealId: last.appealId,
      }),
    }),
  }
}

export async function resolvePublicProfileAppeal(input: Readonly<{
  resolutionId: string
  actorMemberId: string
  appealId: string
  command: PublicProfileAppealResolutionCommand
  occurredAt: string
  store: PublicProfileAppealStore
}>) {
  assertPublicProfileAppealResolutionCommand(input.command)
  assertTimestamp(input.occurredAt)
  const outcome = await input.store.resolveAppeal({
    resolutionId: input.resolutionId,
    actorMemberId: input.actorMemberId,
    appealId: input.appealId,
    command: input.command,
    occurredAt: input.occurredAt,
    fingerprint: fingerprint({
      actorMemberId: input.actorMemberId,
      appealId: input.appealId,
      command: input.command,
    }),
  })
  if (outcome.status === 'conflict') {
    throw new PublicProfileAppealConflictError('resolutionId is already used')
  }
  if (outcome.status === 'target-not-found') {
    throw new PublicProfileAppealTargetNotFoundError('Public Profile appeal not found')
  }
  if (outcome.status === 'already-resolved') {
    throw new PublicProfileAppealAlreadyResolvedError('Public Profile appeal is already resolved')
  }
  if (outcome.status === 'target-changed') {
    throw new PublicProfileAppealTargetChangedError('Public Profile moderation changed')
  }
  return outcome
}

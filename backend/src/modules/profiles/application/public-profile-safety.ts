import { createHash } from 'node:crypto'

import {
  assertPublicProfileModerationCommand,
  assertPublicProfileReportReason,
  InvalidPublicProfileReportCursorError,
  PublicProfileModerationConflictError,
  PublicProfileModerationTargetNotFoundError,
  PublicProfileModerationVersionConflictError,
  PublicProfileReportConflictError,
  PublicProfileReportTargetNotFoundError,
  PublicProfileSelfReportError,
  type PendingPublicProfileReport,
  type PublicProfileModerationAttempt,
  type PublicProfileModerationCommand,
  type PublicProfileModerationOutcome,
  type PublicProfileModerationRecord,
  type PublicProfileReportAttempt,
  type PublicProfileReportOutcome,
  type PublicProfileReportReason,
} from '../domain/safety.js'
import {
  decodePublicProfileReportCursor,
  encodePublicProfileReportCursor,
  type PublicProfileReportCursor,
} from './profile-report-cursor.js'

const reportRetentionMilliseconds = 180 * 24 * 60 * 60 * 1_000

export interface PublicProfileSafetyStore {
  report(attempt: PublicProfileReportAttempt): Promise<PublicProfileReportOutcome>
  getModeration(handle: string): Promise<PublicProfileModerationRecord | undefined>
  moderate(attempt: PublicProfileModerationAttempt): Promise<PublicProfileModerationOutcome>
  listPendingReports(input: Readonly<{
    before?: PublicProfileReportCursor
    limit: number
    now: string
  }>): Promise<readonly PendingPublicProfileReport[]>
  deleteExpiredReports(input: Readonly<{ now: string; limit: number }>): Promise<number>
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

export async function reportPublicProfile(input: Readonly<{
  reportId: string
  reporterMemberId: string
  handle: string
  reason: PublicProfileReportReason
  occurredAt: string
  store: PublicProfileSafetyStore
}>) {
  assertPublicProfileReportReason(input.reason)
  if (!validTimestamp(input.occurredAt)) throw new Error('occurredAt must be an ISO timestamp')
  const expiresAt = new Date(Date.parse(input.occurredAt) + reportRetentionMilliseconds).toISOString()
  const outcome = await input.store.report({
    reportId: input.reportId,
    reporterMemberId: input.reporterMemberId,
    handle: input.handle,
    reason: input.reason,
    occurredAt: input.occurredAt,
    expiresAt,
    fingerprint: fingerprint({
      reporterMemberId: input.reporterMemberId,
      handle: input.handle,
      reason: input.reason,
    }),
  })
  if (outcome.status === 'conflict') {
    throw new PublicProfileReportConflictError('reportId is already used')
  }
  if (outcome.status === 'target-not-found') {
    throw new PublicProfileReportTargetNotFoundError('Public Profile is not reportable')
  }
  if (outcome.status === 'self-report') {
    throw new PublicProfileSelfReportError('A member cannot report their own Public Profile')
  }
  return outcome
}

export async function moderatePublicProfile(input: Readonly<{
  decisionId: string
  actorMemberId: string
  handle: string
  command: PublicProfileModerationCommand
  occurredAt: string
  store: PublicProfileSafetyStore
}>) {
  assertPublicProfileModerationCommand(input.command)
  if (!validTimestamp(input.occurredAt)) throw new Error('occurredAt must be an ISO timestamp')
  const outcome = await input.store.moderate({
    decisionId: input.decisionId,
    actorMemberId: input.actorMemberId,
    handle: input.handle,
    command: input.command,
    occurredAt: input.occurredAt,
    fingerprint: fingerprint({
      actorMemberId: input.actorMemberId,
      handle: input.handle,
      command: input.command,
    }),
  })
  if (outcome.status === 'conflict') {
    throw new PublicProfileModerationConflictError('decisionId is already used')
  }
  if (outcome.status === 'target-not-found') {
    throw new PublicProfileModerationTargetNotFoundError('Public Profile cannot be moderated')
  }
  if (outcome.status === 'version-conflict') {
    throw new PublicProfileModerationVersionConflictError('Public Profile moderation changed concurrently')
  }
  return outcome
}

export async function listPendingPublicProfileReports(input: Readonly<{
  cursor?: string
  limit: number
  now: string
  store: PublicProfileSafetyStore
}>) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50 || !validTimestamp(input.now)) {
    throw new InvalidPublicProfileReportCursorError('Public Profile report query is invalid')
  }
  const before = input.cursor === undefined
    ? undefined
    : decodePublicProfileReportCursor(input.cursor)
  const rows = await input.store.listPendingReports({
    ...(before === undefined ? {} : { before }),
    limit: input.limit + 1,
    now: input.now,
  })
  const reports = rows.slice(0, input.limit)
  const last = reports.at(-1)
  return {
    schemaVersion: 'public-profile-report-queue.v1' as const,
    reports,
    ...(rows.length <= input.limit || last === undefined ? {} : {
      nextCursor: encodePublicProfileReportCursor({
        reportedAt: last.reportedAt,
        reportId: last.reportId,
      }),
    }),
  }
}

export async function readPublicProfileModeration(input: Readonly<{
  handle: string
  store: PublicProfileSafetyStore
}>) {
  const moderation = await input.store.getModeration(input.handle)
  return moderation === undefined ? undefined : {
    schemaVersion: 'public-profile-moderation.v1' as const,
    ...moderation,
  }
}

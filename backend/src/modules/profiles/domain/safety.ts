export const publicProfileReportReasons = [
  'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content',
] as const
export type PublicProfileReportReason = (typeof publicProfileReportReasons)[number]

export type PublicProfileModerationState = 'allowed' | 'withheld'
export type PublicProfileAllowReason = 'insufficient-evidence' | 'appeal-accepted'
export type PublicProfileModerationReason = PublicProfileReportReason | PublicProfileAllowReason

export type PublicProfileReportAttempt = Readonly<{
  reportId: string
  reporterMemberId: string
  handle: string
  reason: PublicProfileReportReason
  fingerprint: string
  occurredAt: string
  expiresAt: string
}>

export type PublicProfileReportOutcome = Readonly<{
  status: 'recorded' | 'replayed' | 'already-reported' | 'conflict' | 'target-not-found' | 'self-report'
}>

export type PublicProfileModerationCommand = Readonly<{
  state: PublicProfileModerationState
  reason: PublicProfileModerationReason
  expectedUpdatedAt: string | null
}>

export type PublicProfileModerationAttempt = Readonly<{
  decisionId: string
  actorMemberId: string
  handle: string
  command: PublicProfileModerationCommand
  fingerprint: string
  occurredAt: string
}>

export type PublicProfileModerationOutcome = Readonly<{
  status: 'applied' | 'replayed' | 'conflict' | 'target-not-found' | 'version-conflict' | 'appeal-pending'
}>

export type PublicProfileModerationRecord = Readonly<{
  handle: string
  state: PublicProfileModerationState
  reason: PublicProfileModerationReason | null
  updatedAt: string | null
}>

export type PendingPublicProfileReport = Readonly<{
  reportId: string
  handle: string
  reason: PublicProfileReportReason
  reportedAt: string
  expiresAt: string
}>

export class InvalidPublicProfileReportError extends Error {
  override readonly name = 'InvalidPublicProfileReportError'
}

export class PublicProfileReportConflictError extends Error {
  override readonly name = 'PublicProfileReportConflictError'
}

export class PublicProfileReportTargetNotFoundError extends Error {
  override readonly name = 'PublicProfileReportTargetNotFoundError'
}

export class PublicProfileSelfReportError extends Error {
  override readonly name = 'PublicProfileSelfReportError'
}

export class InvalidPublicProfileModerationError extends Error {
  override readonly name = 'InvalidPublicProfileModerationError'
}

export class PublicProfileModerationConflictError extends Error {
  override readonly name = 'PublicProfileModerationConflictError'
}

export class PublicProfileModerationTargetNotFoundError extends Error {
  override readonly name = 'PublicProfileModerationTargetNotFoundError'
}

export class PublicProfileModerationVersionConflictError extends Error {
  override readonly name = 'PublicProfileModerationVersionConflictError'
}

export class PublicProfileModerationAppealPendingError extends Error {
  override readonly name = 'PublicProfileModerationAppealPendingError'
}

export class InvalidPublicProfileReportCursorError extends Error {
  override readonly name = 'InvalidPublicProfileReportCursorError'
}

export function assertPublicProfileReportReason(reason: string): asserts reason is PublicProfileReportReason {
  if (!publicProfileReportReasons.includes(reason as PublicProfileReportReason)) {
    throw new InvalidPublicProfileReportError('Public Profile report reason is invalid')
  }
}

export function assertPublicProfileModerationCommand(command: PublicProfileModerationCommand): void {
  const withheld = command.state === 'withheld' &&
    publicProfileReportReasons.includes(command.reason as PublicProfileReportReason)
  const allowed = command.state === 'allowed' && command.reason === 'insufficient-evidence'
  if (!withheld && !allowed) {
    throw new InvalidPublicProfileModerationError('Public Profile moderation reason is invalid')
  }
  if (command.expectedUpdatedAt !== null && Number.isNaN(Date.parse(command.expectedUpdatedAt))) {
    throw new InvalidPublicProfileModerationError('Public Profile moderation version is invalid')
  }
}

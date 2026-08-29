import type { PublicProfileModerationReason, PublicProfileReportReason } from './safety.js'

export const publicProfileAppealReasons = [
  'mistaken-identity', 'issue-corrected', 'decision-context',
] as const
export type PublicProfileAppealReason = (typeof publicProfileAppealReasons)[number]

export const publicProfileAppealRejectionReasons = [
  'decision-upheld', 'insufficient-remediation',
] as const
export type PublicProfileAppealRejectionReason =
  (typeof publicProfileAppealRejectionReasons)[number]

export type PublicProfileAppealStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'
export type PublicProfileOwnerNoticeKind = 'withheld' | 'restored' | 'appeal-rejected'

export type PublicProfileAppealSummary = Readonly<{
  appealId: string
  reason: PublicProfileAppealReason
  status: PublicProfileAppealStatus
  submittedAt: string
  resolvedAt: string | null
  resolutionReason: PublicProfileAppealRejectionReason | 'appeal-accepted' | 'profile-deleted' | null
}>

export type PublicProfileOwnerNotice = Readonly<{
  noticeId: string
  handle: string
  kind: PublicProfileOwnerNoticeKind
  reason: PublicProfileModerationReason | PublicProfileAppealRejectionReason
  createdAt: string
  acknowledgedAt: string | null
  appeal: PublicProfileAppealSummary | null
}>

export type PendingPublicProfileAppeal = Readonly<{
  appealId: string
  handle: string
  reason: PublicProfileAppealReason
  submittedAt: string
  moderationReason: PublicProfileReportReason
  moderationDecidedAt: string
}>

export type PublicProfileAppealAttempt = Readonly<{
  appealId: string
  ownerMemberId: string
  noticeId: string
  reason: PublicProfileAppealReason
  fingerprint: string
  occurredAt: string
}>

export type PublicProfileAppealOutcome = Readonly<{
  status: 'recorded' | 'replayed' | 'already-appealed' | 'conflict' | 'target-not-found' | 'target-changed'
}>

export type PublicProfileAppealResolutionCommand =
  | Readonly<{ outcome: 'accepted' }>
  | Readonly<{ outcome: 'rejected'; reason: PublicProfileAppealRejectionReason }>

export type PublicProfileAppealResolutionAttempt = Readonly<{
  resolutionId: string
  actorMemberId: string
  appealId: string
  command: PublicProfileAppealResolutionCommand
  fingerprint: string
  occurredAt: string
}>

export type PublicProfileAppealResolutionOutcome = Readonly<{
  status: 'applied' | 'replayed' | 'conflict' | 'target-not-found' | 'already-resolved' | 'target-changed'
}>

export type PublicProfileNoticeAcknowledgementOutcome = Readonly<{
  status: 'acknowledged' | 'already-acknowledged' | 'target-not-found'
  acknowledgedAt?: string
}>

export class InvalidPublicProfileAppealError extends Error {
  override readonly name = 'InvalidPublicProfileAppealError'
}

export class InvalidPublicProfileAppealCursorError extends Error {
  override readonly name = 'InvalidPublicProfileAppealCursorError'
}

export class PublicProfileAppealConflictError extends Error {
  override readonly name = 'PublicProfileAppealConflictError'
}

export class PublicProfileAppealTargetNotFoundError extends Error {
  override readonly name = 'PublicProfileAppealTargetNotFoundError'
}

export class PublicProfileAppealTargetChangedError extends Error {
  override readonly name = 'PublicProfileAppealTargetChangedError'
}

export class PublicProfileAppealAlreadyResolvedError extends Error {
  override readonly name = 'PublicProfileAppealAlreadyResolvedError'
}

export function assertPublicProfileAppealReason(
  reason: string,
): asserts reason is PublicProfileAppealReason {
  if (!publicProfileAppealReasons.includes(reason as PublicProfileAppealReason)) {
    throw new InvalidPublicProfileAppealError('Public Profile appeal reason is invalid')
  }
}

export function assertPublicProfileAppealResolutionCommand(
  command: PublicProfileAppealResolutionCommand,
): void {
  if (
    command.outcome === 'rejected' &&
    !publicProfileAppealRejectionReasons.includes(command.reason)
  ) throw new InvalidPublicProfileAppealError('Public Profile appeal resolution is invalid')
}

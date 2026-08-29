import type { Pool, PoolClient } from 'pg'

import type {
  PublicProfileAppealStore,
} from '../../application/public-profile-appeals.js'
import type {
  PendingPublicProfileAppeal,
  PublicProfileAppealAttempt,
  PublicProfileAppealReason,
  PublicProfileAppealRejectionReason,
  PublicProfileAppealResolutionAttempt,
  PublicProfileAppealStatus,
  PublicProfileOwnerNotice,
  PublicProfileOwnerNoticeKind,
} from '../../domain/appeals.js'
import type {
  PublicProfileModerationReason,
  PublicProfileReportReason,
} from '../../domain/safety.js'

type AppealReceiptRow = Readonly<{ appeal_fingerprint: string }>
type ResolutionReceiptRow = Readonly<{ resolution_fingerprint: string }>
type AppealTargetRow = Readonly<{
  handle: string
  moderation_decision_id: string
  moderation_state: 'allowed' | 'withheld'
  current_decision_id: string
}>
type NoticeRow = Readonly<{
  notice_id: string
  handle: string
  kind: PublicProfileOwnerNoticeKind
  notice_reason: PublicProfileModerationReason | PublicProfileAppealRejectionReason
  created_at: Date
  acknowledged_at: Date | null
  appeal_id: string | null
  appeal_reason: PublicProfileAppealReason | null
  appeal_status: PublicProfileAppealStatus | null
  submitted_at: Date | null
  resolved_at: Date | null
  resolution_reason:
    | PublicProfileAppealRejectionReason
    | 'appeal-accepted'
    | 'profile-deleted'
    | null
}>
type PendingAppealRow = Readonly<{
  appeal_id: string
  handle: string
  appeal_reason: PublicProfileAppealReason
  submitted_at: Date
  moderation_reason: PublicProfileReportReason
  moderation_decided_at: Date
}>
type ResolveTargetRow = Readonly<{
  appeal_id: string
  handle: string
  status: PublicProfileAppealStatus
  submitted_at: Date
  owner_membership_id: string | null
  profile_membership_id: string
  moderation_decision_id: string
  current_decision_id: string
  moderation_state: 'allowed' | 'withheld'
  moderation_reason: PublicProfileModerationReason
  moderation_updated_at: Date
}>

function nextTimestamp(occurredAt: string, ...current: Date[]): string {
  const proposed = new Date(occurredAt)
  const latest = current.reduce<Date | undefined>(
    (value, candidate) => value === undefined || candidate > value ? candidate : value,
    undefined,
  )
  if (latest === undefined || proposed > latest) return proposed.toISOString()
  return new Date(latest.getTime() + 1).toISOString()
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function submitAppealInTransaction(
  client: PoolClient,
  attempt: PublicProfileAppealAttempt,
) {
  const prior = await client.query<AppealReceiptRow>(
    `SELECT appeal_fingerprint
       FROM profiles.public_profile_appeals
      WHERE appeal_id = $1::uuid`,
    [attempt.appealId],
  )
  if (prior.rows[0] !== undefined) {
    return prior.rows[0].appeal_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const target = await client.query<AppealTargetRow>(
    `SELECT notice.handle,
            notice.moderation_decision_id,
            moderation.state AS moderation_state,
            moderation.decision_id AS current_decision_id
       FROM profiles.public_profile_owner_notices notice
       JOIN profiles.public_profiles profile
         ON profile.handle = notice.handle
        AND profile.membership_id = notice.owner_membership_id
       JOIN profiles.public_profile_moderation moderation
         ON moderation.handle = notice.handle
      WHERE notice.notice_id = $1::uuid
        AND notice.owner_membership_id = $2::uuid
        AND notice.kind = 'withheld'
      FOR UPDATE OF notice, profile, moderation`,
    [attempt.noticeId, attempt.ownerMemberId],
  )
  const row = target.rows[0]
  if (row === undefined) return { status: 'target-not-found' as const }
  if (row.moderation_state !== 'withheld' || row.current_decision_id !== row.moderation_decision_id) {
    return { status: 'target-changed' as const }
  }

  const raced = await client.query<AppealReceiptRow>(
    `SELECT appeal_fingerprint
       FROM profiles.public_profile_appeals
      WHERE appeal_id = $1::uuid`,
    [attempt.appealId],
  )
  if (raced.rows[0] !== undefined) {
    return raced.rows[0].appeal_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const inserted = await client.query<{ appeal_id: string }>(
    `INSERT INTO profiles.public_profile_appeals (
       appeal_id, owner_membership_id, handle, moderation_decision_id,
       reason, appeal_fingerprint, status, submitted_at, resolution_id, resolved_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, 'pending', $7::timestamptz, NULL, NULL)
     ON CONFLICT DO NOTHING
     RETURNING appeal_id`,
    [
      attempt.appealId,
      attempt.ownerMemberId,
      row.handle,
      row.moderation_decision_id,
      attempt.reason,
      attempt.fingerprint,
      attempt.occurredAt,
    ],
  )
  if (inserted.rows.length !== 0) {
    await client.query(
      `UPDATE profiles.public_profile_owner_notices
          SET acknowledged_at = GREATEST(created_at, $3::timestamptz)
        WHERE notice_id = $1::uuid
          AND owner_membership_id = $2::uuid
          AND acknowledged_at IS NULL`,
      [attempt.noticeId, attempt.ownerMemberId, attempt.occurredAt],
    )
    return { status: 'recorded' as const }
  }

  const collision = await client.query<AppealReceiptRow>(
    `SELECT appeal_fingerprint
       FROM profiles.public_profile_appeals
      WHERE appeal_id = $1::uuid`,
    [attempt.appealId],
  )
  if (collision.rows[0] !== undefined) {
    return collision.rows[0].appeal_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }
  return { status: 'already-appealed' as const }
}

async function resolveAppealInTransaction(
  client: PoolClient,
  attempt: PublicProfileAppealResolutionAttempt,
) {
  const prior = await client.query<ResolutionReceiptRow>(
    `SELECT resolution_fingerprint
       FROM profiles.public_profile_appeal_resolutions
      WHERE resolution_id = $1::uuid`,
    [attempt.resolutionId],
  )
  if (prior.rows[0] !== undefined) {
    return prior.rows[0].resolution_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }
  const idCollision = await client.query(
    `SELECT 1
       FROM profiles.public_profile_owner_notices
      WHERE notice_id = $1::uuid
     UNION ALL
     SELECT 1
       FROM profiles.public_profile_moderation_decisions
      WHERE decision_id = $1::uuid
     LIMIT 1`,
    [attempt.resolutionId],
  )
  if (idCollision.rows.length !== 0) return { status: 'conflict' as const }

  const target = await client.query<ResolveTargetRow>(
    `SELECT appeal.appeal_id,
            appeal.handle,
            appeal.status,
            appeal.submitted_at,
            appeal.owner_membership_id,
            profile.membership_id AS profile_membership_id,
            appeal.moderation_decision_id,
            moderation.decision_id AS current_decision_id,
            moderation.state AS moderation_state,
            moderation.reason AS moderation_reason,
            moderation.updated_at AS moderation_updated_at
       FROM profiles.public_profile_appeals appeal
       JOIN profiles.public_profiles profile ON profile.handle = appeal.handle
       JOIN profiles.public_profile_moderation moderation ON moderation.handle = appeal.handle
      WHERE appeal.appeal_id = $1::uuid
      FOR UPDATE OF appeal, profile, moderation`,
    [attempt.appealId],
  )
  const row = target.rows[0]
  if (row === undefined) return { status: 'target-not-found' as const }
  if (row.status !== 'pending') return { status: 'already-resolved' as const }
  if (
    row.moderation_state !== 'withheld' ||
    row.current_decision_id !== row.moderation_decision_id ||
    row.owner_membership_id !== row.profile_membership_id
  ) return { status: 'target-changed' as const }

  const raced = await client.query<ResolutionReceiptRow>(
    `SELECT resolution_fingerprint
       FROM profiles.public_profile_appeal_resolutions
      WHERE resolution_id = $1::uuid`,
    [attempt.resolutionId],
  )
  if (raced.rows[0] !== undefined) {
    return raced.rows[0].resolution_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const changedAt = nextTimestamp(
    attempt.occurredAt,
    row.submitted_at,
    row.moderation_updated_at,
  )
  const accepted = attempt.command.outcome === 'accepted'
  const resolutionReason = accepted ? 'appeal-accepted' : attempt.command.reason
  await client.query(
    `INSERT INTO profiles.public_profile_appeal_resolutions (
       resolution_id, appeal_id, actor_membership_id, outcome, reason,
       resolution_fingerprint, decided_at
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::timestamptz)`,
    [
      attempt.resolutionId,
      attempt.appealId,
      attempt.actorMemberId,
      attempt.command.outcome,
      resolutionReason,
      attempt.fingerprint,
      changedAt,
    ],
  )

  if (accepted) {
    await client.query(
      `INSERT INTO profiles.public_profile_moderation_decisions (
         decision_id, handle, actor_membership_id, previous_state, next_state,
         reason, decision_fingerprint, decided_at
       ) VALUES ($1::uuid, $2, $3::uuid, 'withheld', 'allowed',
                 'appeal-accepted', $4, $5::timestamptz)`,
      [attempt.resolutionId, row.handle, attempt.actorMemberId, attempt.fingerprint, changedAt],
    )
    await client.query(
      `UPDATE profiles.public_profile_moderation
          SET state = 'allowed',
              reason = 'appeal-accepted',
              decided_by_membership_id = $2::uuid,
              updated_at = $3::timestamptz,
              decision_id = $4::uuid
        WHERE handle = $1`,
      [row.handle, attempt.actorMemberId, changedAt, attempt.resolutionId],
    )
  }

  await client.query(
    `UPDATE profiles.public_profile_appeals
        SET status = $2,
            resolution_id = $3::uuid,
            resolved_at = $4::timestamptz
      WHERE appeal_id = $1::uuid`,
    [attempt.appealId, attempt.command.outcome, attempt.resolutionId, changedAt],
  )
  await client.query(
    `INSERT INTO profiles.public_profile_owner_notices (
       notice_id, owner_membership_id, handle, moderation_decision_id,
       appeal_resolution_id, kind, reason, created_at, acknowledged_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $1::uuid, $5, $6, $7::timestamptz, NULL)`,
    [
      attempt.resolutionId,
      row.profile_membership_id,
      row.handle,
      accepted ? attempt.resolutionId : row.moderation_decision_id,
      accepted ? 'restored' : 'appeal-rejected',
      resolutionReason,
      changedAt,
    ],
  )
  return { status: 'applied' as const }
}

export class PostgresPublicProfileAppealStore implements PublicProfileAppealStore {
  constructor(private readonly pool: Pool) {}

  async listOwnerNotices(input: Readonly<{
    ownerMemberId: string
    before?: Readonly<{ createdAt: string; noticeId: string }>
    limit: number
  }>): Promise<readonly PublicProfileOwnerNotice[]> {
    const result = await this.pool.query<NoticeRow>(
      `SELECT notice.notice_id,
              notice.handle,
              notice.kind,
              notice.reason AS notice_reason,
              notice.created_at,
              notice.acknowledged_at,
              appeal.appeal_id,
              appeal.reason AS appeal_reason,
              appeal.status AS appeal_status,
              appeal.submitted_at,
              appeal.resolved_at,
              resolution.reason AS resolution_reason
         FROM profiles.public_profile_owner_notices notice
         LEFT JOIN profiles.public_profile_appeals appeal
           ON appeal.moderation_decision_id = notice.moderation_decision_id
         LEFT JOIN profiles.public_profile_appeal_resolutions resolution
           ON resolution.resolution_id = appeal.resolution_id
        WHERE notice.owner_membership_id = $1::uuid
          AND ($2::timestamptz IS NULL OR (notice.created_at, notice.notice_id) < ($2::timestamptz, $3::uuid))
        ORDER BY notice.created_at DESC, notice.notice_id DESC
        LIMIT $4`,
      [input.ownerMemberId, input.before?.createdAt ?? null, input.before?.noticeId ?? null, input.limit],
    )
    return result.rows.map((row) => ({
      noticeId: row.notice_id,
      handle: row.handle,
      kind: row.kind,
      reason: row.notice_reason,
      createdAt: row.created_at.toISOString(),
      acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
      appeal: row.appeal_id === null ? null : {
        appealId: row.appeal_id,
        reason: row.appeal_reason!,
        status: row.appeal_status!,
        submittedAt: row.submitted_at!.toISOString(),
        resolvedAt: row.resolved_at?.toISOString() ?? null,
        resolutionReason: row.resolution_reason,
      },
    }))
  }

  async acknowledgeOwnerNotice(input: Readonly<{
    ownerMemberId: string
    noticeId: string
    occurredAt: string
  }>) {
    const updated = await this.pool.query<{ acknowledged_at: Date }>(
      `UPDATE profiles.public_profile_owner_notices
          SET acknowledged_at = GREATEST(created_at, $3::timestamptz)
        WHERE notice_id = $1::uuid
          AND owner_membership_id = $2::uuid
          AND acknowledged_at IS NULL
      RETURNING acknowledged_at`,
      [input.noticeId, input.ownerMemberId, input.occurredAt],
    )
    if (updated.rows[0] !== undefined) {
      return {
        status: 'acknowledged' as const,
        acknowledgedAt: updated.rows[0].acknowledged_at.toISOString(),
      }
    }
    const existing = await this.pool.query<{ acknowledged_at: Date | null }>(
      `SELECT acknowledged_at
         FROM profiles.public_profile_owner_notices
        WHERE notice_id = $1::uuid
          AND owner_membership_id = $2::uuid`,
      [input.noticeId, input.ownerMemberId],
    )
    const row = existing.rows[0]
    return row === undefined
      ? { status: 'target-not-found' as const }
      : {
          status: 'already-acknowledged' as const,
          acknowledgedAt: row.acknowledged_at!.toISOString(),
        }
  }

  submitAppeal(attempt: PublicProfileAppealAttempt) {
    return transaction(this.pool, (client) => submitAppealInTransaction(client, attempt))
  }

  async listPendingAppeals(input: Readonly<{
    before?: Readonly<{ submittedAt: string; appealId: string }>
    limit: number
  }>): Promise<readonly PendingPublicProfileAppeal[]> {
    const result = await this.pool.query<PendingAppealRow>(
      `SELECT appeal.appeal_id,
              appeal.handle,
              appeal.reason AS appeal_reason,
              appeal.submitted_at,
              decision.reason AS moderation_reason,
              decision.decided_at AS moderation_decided_at
         FROM profiles.public_profile_appeals appeal
         JOIN profiles.public_profiles profile ON profile.handle = appeal.handle
         JOIN profiles.public_profile_moderation moderation
           ON moderation.handle = appeal.handle
          AND moderation.decision_id = appeal.moderation_decision_id
          AND moderation.state = 'withheld'
         JOIN profiles.public_profile_moderation_decisions decision
           ON decision.decision_id = appeal.moderation_decision_id
        WHERE appeal.status = 'pending'
          AND ($1::timestamptz IS NULL OR (appeal.submitted_at, appeal.appeal_id) > ($1::timestamptz, $2::uuid))
        ORDER BY appeal.submitted_at, appeal.appeal_id
        LIMIT $3`,
      [input.before?.submittedAt ?? null, input.before?.appealId ?? null, input.limit],
    )
    return result.rows.map((row) => ({
      appealId: row.appeal_id,
      handle: row.handle,
      reason: row.appeal_reason,
      submittedAt: row.submitted_at.toISOString(),
      moderationReason: row.moderation_reason,
      moderationDecidedAt: row.moderation_decided_at.toISOString(),
    }))
  }

  resolveAppeal(attempt: PublicProfileAppealResolutionAttempt) {
    return transaction(this.pool, (client) => resolveAppealInTransaction(client, attempt))
  }
}

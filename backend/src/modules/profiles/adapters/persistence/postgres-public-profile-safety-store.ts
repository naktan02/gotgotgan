import type { Pool, PoolClient } from 'pg'

import type { PublicProfileSafetyStore } from '../../application/public-profile-safety.js'
import type {
  PendingPublicProfileReport,
  PublicProfileModerationAttempt,
  PublicProfileModerationRecord,
  PublicProfileReportAttempt,
  PublicProfileReportReason,
} from '../../domain/safety.js'

type ReportReceiptRow = Readonly<{ report_fingerprint: string }>
type ProfileSafetyRow = Readonly<{
  membership_id: string
  visibility: 'hidden' | 'public'
  moderation_state: 'allowed' | 'withheld'
}>
type ModerationRow = Readonly<{
  state: 'allowed' | 'withheld'
  reason: PublicProfileModerationRecord['reason']
  updated_at: Date
}>
type DecisionReceiptRow = Readonly<{ decision_fingerprint: string }>
type PendingReportRow = Readonly<{
  report_id: string
  handle: string
  reason: PublicProfileReportReason
  reported_at: Date
  expires_at: Date
}>

function nextTimestamp(occurredAt: string, current?: Date): string {
  const proposed = new Date(occurredAt)
  if (current === undefined || proposed.getTime() > current.getTime()) return proposed.toISOString()
  return new Date(current.getTime() + 1).toISOString()
}

async function reportInTransaction(client: PoolClient, attempt: PublicProfileReportAttempt) {
  await client.query(
    `DELETE FROM profiles.public_profile_reports
      WHERE expires_at <= $1::timestamptz
        AND (report_id = $2::uuid OR (reporter_membership_id = $3::uuid AND handle = $4))`,
    [attempt.occurredAt, attempt.reportId, attempt.reporterMemberId, attempt.handle],
  )
  const prior = await client.query<ReportReceiptRow>(
    `SELECT report_fingerprint FROM profiles.public_profile_reports WHERE report_id = $1::uuid`,
    [attempt.reportId],
  )
  if (prior.rows[0] !== undefined) {
    return prior.rows[0].report_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const target = await client.query<ProfileSafetyRow>(
    `SELECT profile.membership_id, profile.visibility,
            COALESCE(moderation.state, 'allowed') AS moderation_state
       FROM profiles.public_profiles profile
       LEFT JOIN profiles.public_profile_moderation moderation
         ON moderation.handle = profile.handle
      WHERE profile.handle = $1
      FOR UPDATE OF profile`,
    [attempt.handle],
  )
  const profile = target.rows[0]
  if (profile === undefined || profile.visibility !== 'public' || profile.moderation_state !== 'allowed') {
    return { status: 'target-not-found' as const }
  }
  if (profile.membership_id === attempt.reporterMemberId) return { status: 'self-report' as const }

  const raced = await client.query<ReportReceiptRow>(
    `SELECT report_fingerprint FROM profiles.public_profile_reports WHERE report_id = $1::uuid`,
    [attempt.reportId],
  )
  if (raced.rows[0] !== undefined) {
    return raced.rows[0].report_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }
  const inserted = await client.query<{ report_id: string }>(
    `INSERT INTO profiles.public_profile_reports (
       report_id, reporter_membership_id, handle, reason, report_fingerprint,
       reported_at, expires_at, reviewed_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, NULL)
     ON CONFLICT DO NOTHING
     RETURNING report_id`,
    [
      attempt.reportId,
      attempt.reporterMemberId,
      attempt.handle,
      attempt.reason,
      attempt.fingerprint,
      attempt.occurredAt,
      attempt.expiresAt,
    ],
  )
  if (inserted.rows.length !== 0) return { status: 'recorded' as const }
  const collision = await client.query<ReportReceiptRow>(
    `SELECT report_fingerprint FROM profiles.public_profile_reports WHERE report_id = $1::uuid`,
    [attempt.reportId],
  )
  if (collision.rows[0] !== undefined) {
    return collision.rows[0].report_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }
  return { status: 'already-reported' as const }
}

async function moderateInTransaction(client: PoolClient, attempt: PublicProfileModerationAttempt) {
  const prior = await client.query<DecisionReceiptRow>(
    `SELECT decision_fingerprint
       FROM profiles.public_profile_moderation_decisions
      WHERE decision_id = $1::uuid`,
    [attempt.decisionId],
  )
  if (prior.rows[0] !== undefined) {
    return prior.rows[0].decision_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const target = await client.query<{ handle: string }>(
    `SELECT handle FROM profiles.public_profiles WHERE handle = $1 FOR UPDATE`,
    [attempt.handle],
  )
  if (target.rows.length === 0) return { status: 'target-not-found' as const }
  const raced = await client.query<DecisionReceiptRow>(
    `SELECT decision_fingerprint
       FROM profiles.public_profile_moderation_decisions
      WHERE decision_id = $1::uuid`,
    [attempt.decisionId],
  )
  if (raced.rows[0] !== undefined) {
    return raced.rows[0].decision_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const currentResult = await client.query<ModerationRow>(
    `SELECT state, reason, updated_at
       FROM profiles.public_profile_moderation
      WHERE handle = $1
      FOR UPDATE`,
    [attempt.handle],
  )
  const current = currentResult.rows[0]
  const expected = attempt.command.expectedUpdatedAt
  if (
    (current === undefined && expected !== null) ||
    (current !== undefined && (expected === null || current.updated_at.toISOString() !== expected))
  ) return { status: 'version-conflict' as const }

  const changedAt = nextTimestamp(attempt.occurredAt, current?.updated_at)
  await client.query(
    `INSERT INTO profiles.public_profile_moderation (
       handle, state, reason, decided_by_membership_id, updated_at
     ) VALUES ($1, $2, $3, $4::uuid, $5::timestamptz)
     ON CONFLICT (handle) DO UPDATE
       SET state = EXCLUDED.state,
           reason = EXCLUDED.reason,
           decided_by_membership_id = EXCLUDED.decided_by_membership_id,
           updated_at = EXCLUDED.updated_at`,
    [attempt.handle, attempt.command.state, attempt.command.reason, attempt.actorMemberId, changedAt],
  )
  await client.query(
    `INSERT INTO profiles.public_profile_moderation_decisions (
       decision_id, handle, actor_membership_id, previous_state, next_state,
       reason, decision_fingerprint, decided_at
     ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::timestamptz)`,
    [
      attempt.decisionId,
      attempt.handle,
      attempt.actorMemberId,
      current?.state ?? 'allowed',
      attempt.command.state,
      attempt.command.reason,
      attempt.fingerprint,
      changedAt,
    ],
  )
  await client.query(
    `UPDATE profiles.public_profile_reports
        SET reviewed_at = GREATEST(reported_at, $2::timestamptz)
      WHERE handle = $1 AND reviewed_at IS NULL`,
    [attempt.handle, changedAt],
  )
  return { status: 'applied' as const }
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

export class PostgresPublicProfileSafetyStore implements PublicProfileSafetyStore {
  constructor(private readonly pool: Pool) {}

  report(attempt: PublicProfileReportAttempt) {
    return transaction(this.pool, (client) => reportInTransaction(client, attempt))
  }

  moderate(attempt: PublicProfileModerationAttempt) {
    return transaction(this.pool, (client) => moderateInTransaction(client, attempt))
  }

  async getModeration(handle: string) {
    const result = await this.pool.query<{
      handle: string
      state: 'allowed' | 'withheld' | null
      reason: PublicProfileModerationRecord['reason']
      updated_at: Date | null
    }>(
      `SELECT profile.handle, moderation.state, moderation.reason, moderation.updated_at
         FROM profiles.public_profiles profile
         LEFT JOIN profiles.public_profile_moderation moderation
           ON moderation.handle = profile.handle
        WHERE profile.handle = $1`,
      [handle],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      handle: row.handle,
      state: row.state ?? 'allowed',
      reason: row.reason,
      updatedAt: row.updated_at?.toISOString() ?? null,
    }
  }

  async listPendingReports(input: Readonly<{
    before?: Readonly<{ reportedAt: string; reportId: string }>
    limit: number
    now: string
  }>): Promise<readonly PendingPublicProfileReport[]> {
    const result = await this.pool.query<PendingReportRow>(
      `SELECT report.report_id, report.handle, report.reason, report.reported_at, report.expires_at
         FROM profiles.public_profile_reports report
         JOIN profiles.public_profiles profile ON profile.handle = report.handle
        WHERE report.reviewed_at IS NULL
          AND report.expires_at > $1::timestamptz
          AND ($2::timestamptz IS NULL OR (report.reported_at, report.report_id) < ($2::timestamptz, $3::uuid))
        ORDER BY report.reported_at DESC, report.report_id DESC
        LIMIT $4`,
      [input.now, input.before?.reportedAt ?? null, input.before?.reportId ?? null, input.limit],
    )
    return result.rows.map((row) => ({
      reportId: row.report_id,
      handle: row.handle,
      reason: row.reason,
      reportedAt: row.reported_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }))
  }

  async deleteExpiredReports(input: Readonly<{ now: string; limit: number }>): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM profiles.public_profile_reports
        WHERE report_id IN (
          SELECT report_id
            FROM profiles.public_profile_reports
           WHERE expires_at <= $1::timestamptz
           ORDER BY expires_at, report_id
           LIMIT $2
        )`,
      [input.now, input.limit],
    )
    return result.rowCount ?? 0
  }
}

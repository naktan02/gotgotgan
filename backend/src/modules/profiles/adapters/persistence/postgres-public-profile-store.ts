import type { Pool, PoolClient } from 'pg'

import type { PublicProfileStore } from '../../application/public-profiles.js'
import type {
  PublicProfileAttempt,
  PublicProfileRecord,
  PublishedProfileOwner,
} from '../../domain/model.js'

type ProfileRow = Readonly<{
  membership_id: string
  handle: string
  display_name: string
  visibility: 'hidden' | 'public'
  created_at: Date
  updated_at: Date
}>

type ReceiptRow = Readonly<{ membership_id: string; command_fingerprint: string }>

function record(row: ProfileRow): PublicProfileRecord {
  return {
    handle: row.handle,
    displayName: row.display_name,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function nextTimestamp(occurredAt: string, current?: Date): string {
  const proposed = new Date(occurredAt)
  if (current === undefined || proposed.getTime() > current.getTime()) return proposed.toISOString()
  return new Date(current.getTime() + 1).toISOString()
}

async function applyInTransaction(client: PoolClient, attempt: PublicProfileAttempt) {
  const receipt = await client.query<ReceiptRow>(
    `SELECT membership_id, command_fingerprint FROM profiles.command_receipts WHERE command_id = $1::uuid`,
    [attempt.commandId],
  )
  const prior = receipt.rows[0]
  if (prior !== undefined) {
    return prior.membership_id === attempt.memberId && prior.command_fingerprint === attempt.fingerprint
      ? { status: 'replayed' as const }
      : { status: 'conflict' as const }
  }

  const existing = await client.query<ProfileRow>(
    `SELECT membership_id, handle, display_name, visibility, created_at, updated_at
       FROM profiles.public_profiles WHERE membership_id = $1::uuid FOR UPDATE`,
    [attempt.memberId],
  )
  const current = existing.rows[0]
  if (current !== undefined && current.handle !== attempt.command.handle) {
    return { status: 'handle-immutable' as const }
  }
  const expected = attempt.command.expectedUpdatedAt
  if (
    (current === undefined && expected !== null) ||
    (current !== undefined && (expected === null || current.updated_at.toISOString() !== expected))
  ) return { status: 'version-conflict' as const }

  const changedAt = nextTimestamp(attempt.occurredAt, current?.updated_at)
  if (current === undefined) {
    const reservation = await client.query<{ handle: string }>(
      `
        INSERT INTO profiles.public_handle_reservations (
          handle, membership_id, reserved_at, retired_at
        ) VALUES ($1, $2::uuid, $3::timestamptz, NULL)
        ON CONFLICT DO NOTHING
        RETURNING handle
      `,
      [attempt.command.handle, attempt.memberId, changedAt],
    )
    if (reservation.rows.length === 0) {
      const raced = await client.query<{ membership_id: string }>(
        `SELECT membership_id FROM profiles.public_profiles WHERE membership_id = $1::uuid`,
        [attempt.memberId],
      )
      return raced.rows.length === 0
        ? { status: 'handle-unavailable' as const }
        : { status: 'version-conflict' as const }
    }
    const inserted = await client.query<{ membership_id: string }>(
      `
        INSERT INTO profiles.public_profiles (
          membership_id, handle, display_name, visibility, created_at, updated_at
        ) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $5::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING membership_id
      `,
      [attempt.memberId, attempt.command.handle, attempt.command.displayName, attempt.command.visibility, changedAt],
    )
    if (inserted.rows.length === 0) {
      const raced = await client.query<{ membership_id: string }>(
        `SELECT membership_id FROM profiles.public_profiles WHERE membership_id = $1::uuid`,
        [attempt.memberId],
      )
      return raced.rows.length === 0
        ? { status: 'handle-unavailable' as const }
        : { status: 'version-conflict' as const }
    }
  } else {
    await client.query(
      `UPDATE profiles.public_profiles
         SET display_name = $2, visibility = $3, updated_at = $4::timestamptz
       WHERE membership_id = $1::uuid`,
      [attempt.memberId, attempt.command.displayName, attempt.command.visibility, changedAt],
    )
  }
  await client.query(
    `INSERT INTO profiles.command_receipts (
       command_id, membership_id, command_fingerprint, occurred_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz)`,
    [attempt.commandId, attempt.memberId, attempt.fingerprint, changedAt],
  )
  return { status: 'applied' as const }
}

export class PostgresPublicProfileStore implements PublicProfileStore {
  constructor(private readonly pool: Pool) {}

  async apply(attempt: PublicProfileAttempt) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const outcome = await applyInTransaction(client, attempt)
      await client.query('COMMIT')
      return outcome
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async getCurrent(memberId: string) {
    const result = await this.pool.query<ProfileRow>(
      `SELECT membership_id, handle, display_name, visibility, created_at, updated_at
         FROM profiles.public_profiles WHERE membership_id = $1::uuid`,
      [memberId],
    )
    return result.rows[0] === undefined ? undefined : record(result.rows[0])
  }

  async getPublished(handle: string): Promise<PublishedProfileOwner | undefined> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT membership_id, handle, display_name, visibility, created_at, updated_at
         FROM profiles.public_profiles WHERE handle = $1 AND visibility = 'public'`,
      [handle],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      ...record(row),
      ownerMemberId: row.membership_id,
      visibility: 'public',
    }
  }
}

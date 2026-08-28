import type { PoolClient } from 'pg'

import {
  LibraryPreferenceVersionConflictError,
  type LibraryAttempt,
  type LibraryCommand,
} from '../../domain/model.js'

type PreferenceCommand = Extract<LibraryCommand, Readonly<{ kind: 'set-place-preferences' }>>

export async function lockPostgresPlacePreference(
  client: PoolClient,
  memberId: string,
  placeId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(
       'place.library.preference.v1:' || $1 || ':' || $2, 0
     ))`,
    [memberId, placeId],
  )
}

export async function applyPreferenceWrite(
  client: PoolClient,
  attempt: LibraryAttempt,
  command: PreferenceCommand,
): Promise<'applied'> {
  await lockPostgresPlacePreference(client, attempt.memberId, command.placeId)
  const prior = await client.query<{
    personal_rating: string | null
    updated_at: Date
  }>(
    `SELECT personal_rating, updated_at FROM library.place_preferences
     WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
    [attempt.memberId, command.placeId],
  )
  const currentUpdatedAt = prior.rows[0]?.updated_at.toISOString() ?? null
  const expectedUpdatedAt = command.expectedUpdatedAt === null
    ? null
    : new Date(command.expectedUpdatedAt).toISOString()
  if (currentUpdatedAt !== expectedUpdatedAt) {
    throw new LibraryPreferenceVersionConflictError('Place preferences changed after they were read')
  }
  await client.query(
    `INSERT INTO library.place_preferences
      (membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz,$6::timestamptz)
     ON CONFLICT (membership_id, canonical_place_id) DO UPDATE
     SET saved = EXCLUDED.saved, wanted = EXCLUDED.wanted,
         personal_rating = EXCLUDED.personal_rating,
         updated_at = greatest(
           EXCLUDED.updated_at,
           library.place_preferences.updated_at + interval '1 millisecond'
         )`,
    [attempt.memberId, command.placeId, command.saved, command.wanted,
      command.personalRating, attempt.occurredAt],
  )
  const previousValue = prior.rows[0]?.personal_rating
  const previous = previousValue === undefined || previousValue === null
    ? null
    : Number(previousValue)
  if (previous !== command.personalRating) {
    await client.query(
      `INSERT INTO library.personal_rating_events
        (command_id, membership_id, canonical_place_id, previous_rating, next_rating, occurred_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz)`,
      [attempt.commandId, attempt.memberId, command.placeId, previous,
        command.personalRating, attempt.occurredAt],
    )
  }
  return 'applied'
}

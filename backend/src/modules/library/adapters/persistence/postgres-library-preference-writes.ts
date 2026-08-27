import type { PoolClient } from 'pg'

import type { LibraryAttempt, LibraryCommand } from '../../domain/model.js'

type PreferenceCommand = Extract<LibraryCommand, Readonly<{ kind: 'set-place-preferences' }>>

export async function applyPreferenceWrite(
  client: PoolClient,
  attempt: LibraryAttempt,
  command: PreferenceCommand,
): Promise<'applied'> {
  const prior = await client.query<{ personal_rating: string | null }>(
    `SELECT personal_rating FROM library.place_preferences
     WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
    [attempt.memberId, command.placeId],
  )
  await client.query(
    `INSERT INTO library.place_preferences
      (membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz,$6::timestamptz)
     ON CONFLICT (membership_id, canonical_place_id) DO UPDATE
     SET saved = EXCLUDED.saved, wanted = EXCLUDED.wanted,
         personal_rating = EXCLUDED.personal_rating, updated_at = EXCLUDED.updated_at`,
    [attempt.memberId, command.placeId, command.saved, command.wanted,
      command.personalRating, attempt.occurredAt],
  )
  const previous = prior.rows[0]?.personal_rating === undefined ||
    prior.rows[0]?.personal_rating === null
    ? null
    : Number(prior.rows[0].personal_rating)
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

import type { PoolClient } from 'pg'

import type { LibraryAttempt, LibraryCommand } from '../../domain/model.js'

type TagCommand = Extract<LibraryCommand, Readonly<{
  kind: 'create-tag' | 'rename-tag' | 'delete-tag' | 'tag-place' | 'untag-place'
}>>

type WriteOutcome = 'applied' | 'not-found' | 'forbidden'

export async function applyTagWrite(
  client: PoolClient,
  attempt: LibraryAttempt,
  command: TagCommand,
): Promise<WriteOutcome> {
  if (command.kind === 'create-tag') {
    const result = await client.query(
      `INSERT INTO library.tags (id, owner_membership_id, name, normalized_name, created_at)
       VALUES ($1::uuid,$2::uuid,$3,lower(trim($3)),$4::timestamptz)
       ON CONFLICT DO NOTHING`,
      [command.tagId, attempt.memberId, command.name, attempt.occurredAt],
    )
    return result.rowCount === 1 ? 'applied' : 'forbidden'
  }

  if (command.kind === 'rename-tag') {
    const result = await client.query(
      `UPDATE library.tags
       SET name = $3, normalized_name = lower(trim($3))
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [command.tagId, attempt.memberId, command.name],
    )
    return result.rowCount === 1 ? 'applied' : 'not-found'
  }

  if (command.kind === 'delete-tag') {
    const owned = await client.query(
      `SELECT id FROM library.tags
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
      [command.tagId, attempt.memberId],
    )
    if (owned.rows[0] === undefined) return 'not-found'
    await client.query(
      `DELETE FROM library.place_tags
       WHERE membership_id = $1::uuid AND tag_id = $2::uuid`,
      [attempt.memberId, command.tagId],
    )
    await client.query('DELETE FROM library.tags WHERE id = $1::uuid', [command.tagId])
    return 'applied'
  }

  if (command.kind === 'tag-place') {
    const owned = await client.query(
      `SELECT id FROM library.tags
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [command.tagId, attempt.memberId],
    )
    if (owned.rows[0] === undefined) return 'not-found'
    await client.query(
      `INSERT INTO library.place_tags (membership_id, canonical_place_id, tag_id, tagged_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::timestamptz)
       ON CONFLICT DO NOTHING`,
      [attempt.memberId, command.placeId, command.tagId, attempt.occurredAt],
    )
    return 'applied'
  }

  const result = await client.query(
    `DELETE FROM library.place_tags AS tagged
     USING library.tags AS tag
     WHERE tagged.membership_id = $1::uuid
       AND tagged.canonical_place_id = $2::uuid
       AND tagged.tag_id = $3::uuid
       AND tag.id = tagged.tag_id
       AND tag.owner_membership_id = $1::uuid`,
    [attempt.memberId, command.placeId, command.tagId],
  )
  return result.rowCount === 1 ? 'applied' : 'not-found'
}

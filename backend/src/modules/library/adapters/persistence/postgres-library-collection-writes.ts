import type { PoolClient } from 'pg'

import {
  LibraryCollectionVersionConflictError,
  type LibraryAttempt,
  type LibraryCommand,
} from '../../domain/model.js'

type CollectionCommand = Extract<LibraryCommand, Readonly<{
  kind:
    | 'create-collection'
    | 'rename-collection'
    | 'set-collection-publication'
    | 'delete-collection'
    | 'add-collection-place'
    | 'remove-collection-place'
    | 'move-collection-place'
    | 'copy-published-collection'
}>>

type WriteOutcome = 'applied' | 'not-found' | 'forbidden'

async function lockOwnedCollection(
  client: PoolClient,
  collectionId: string,
  memberId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id FROM library.collections
     WHERE id = $1::uuid AND owner_membership_id = $2::uuid
     FOR UPDATE`,
    [collectionId, memberId],
  )
  return result.rows[0] !== undefined
}

async function touchCollection(
  client: PoolClient,
  collectionId: string,
  occurredAt: string,
): Promise<void> {
  await client.query(
    `UPDATE library.collections
     SET revision = revision + 1,
         updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
     WHERE id = $1::uuid`,
    [collectionId, occurredAt],
  )
}

async function moveCollectionPlace(
  client: PoolClient,
  input: Readonly<{
    collectionId: string
    placeId: string
    position: number
    occurredAt: string
  }>,
): Promise<WriteOutcome> {
  const current = await client.query<{ position: number }>(
    `SELECT position FROM library.collection_places
     WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid
     FOR UPDATE`,
    [input.collectionId, input.placeId],
  )
  const currentPosition = current.rows[0]?.position
  if (currentPosition === undefined) return 'not-found'
  if (currentPosition !== input.position) {
    await client.query('SET CONSTRAINTS library.collection_places_position_unique DEFERRED')
    await client.query(
      `UPDATE library.collection_places
       SET position = CASE
         WHEN canonical_place_id = $2::uuid THEN $4::int
         WHEN $4::int < $3::int THEN position + 1
         ELSE position - 1
       END
       WHERE collection_id = $1::uuid
         AND (
           canonical_place_id = $2::uuid
           OR ($4::int < $3::int AND position >= $4::int AND position < $3::int)
           OR ($4::int > $3::int AND position > $3::int AND position <= $4::int)
         )`,
      [input.collectionId, input.placeId, currentPosition, input.position],
    )
  }
  await touchCollection(client, input.collectionId, input.occurredAt)
  return 'applied'
}

export async function applyCollectionWrite(
  client: PoolClient,
  attempt: LibraryAttempt,
  command: CollectionCommand,
): Promise<WriteOutcome> {
  if (command.kind === 'create-collection') {
    const result = await client.query(
      `INSERT INTO library.collections
        (id, owner_membership_id, name, description, visibility, publication_id, created_at, updated_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,'private',NULL,$5::timestamptz,$5::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [command.collectionId, attempt.memberId, command.name, command.description ?? null,
        attempt.occurredAt],
    )
    return result.rowCount === 1 ? 'applied' : 'forbidden'
  }

  if (command.kind === 'rename-collection') {
    const result = await client.query(
      `UPDATE library.collections
       SET name = $3,
           revision = revision + 1,
           updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [command.collectionId, attempt.memberId, command.name, attempt.occurredAt],
    )
    return result.rowCount === 1 ? 'applied' : 'not-found'
  }

  if (command.kind === 'set-collection-publication') {
    const current = await client.query<{
      visibility: 'private' | 'unlisted' | 'public'
      updated_at: Date
    }>(
      `SELECT visibility, updated_at FROM library.collections
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid
       FOR UPDATE`,
      [command.collectionId, attempt.memberId],
    )
    const collection = current.rows[0]
    if (collection === undefined) return 'not-found'
    if (collection.updated_at.toISOString() !== command.expectedUpdatedAt) {
      throw new LibraryCollectionVersionConflictError('Collection changed after it was read')
    }
    await client.query(
      `UPDATE library.collections
       SET visibility = $3,
           publication_id = CASE
             WHEN $3 = 'private' THEN NULL
             WHEN visibility = 'private' THEN gen_random_uuid()
           ELSE publication_id
           END,
           revision = revision + 1,
           updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [command.collectionId, attempt.memberId, command.visibility, attempt.occurredAt],
    )
    return 'applied'
  }

  if (command.kind === 'delete-collection') {
    if (!await lockOwnedCollection(client, command.collectionId, attempt.memberId)) {
      return 'not-found'
    }
    await client.query(
      'DELETE FROM library.collection_place_import_provenance WHERE collection_id = $1::uuid',
      [command.collectionId],
    )
    await client.query(
      'DELETE FROM library.collection_import_provenance WHERE collection_id = $1::uuid',
      [command.collectionId],
    )
    await client.query(
      'DELETE FROM library.collection_copy_provenance WHERE target_collection_id = $1::uuid',
      [command.collectionId],
    )
    await client.query(
      'DELETE FROM library.collection_places WHERE collection_id = $1::uuid',
      [command.collectionId],
    )
    await client.query('DELETE FROM library.collections WHERE id = $1::uuid', [command.collectionId])
    return 'applied'
  }

  if (command.kind === 'add-collection-place') {
    if (!await lockOwnedCollection(client, command.collectionId, attempt.memberId)) {
      return 'not-found'
    }
    const existing = await client.query(
      `SELECT position FROM library.collection_places
       WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
      [command.collectionId, command.placeId],
    )
    if (existing.rows[0] !== undefined) {
      if (command.position === undefined) return 'applied'
      return moveCollectionPlace(client, {
        collectionId: command.collectionId,
        placeId: command.placeId,
        position: command.position,
        occurredAt: attempt.occurredAt,
      })
    }
    const position = command.position ?? Number((await client.query<{ position: number }>(
      `SELECT coalesce(max(position) + 1, 0)::int AS position
       FROM library.collection_places WHERE collection_id = $1::uuid`,
      [command.collectionId],
    )).rows[0]?.position ?? 0)
    await client.query('SET CONSTRAINTS library.collection_places_position_unique DEFERRED')
    await client.query(
      `UPDATE library.collection_places
       SET position = position + 1
       WHERE collection_id = $1::uuid AND position >= $2::int`,
      [command.collectionId, position],
    )
    await client.query(
      `INSERT INTO library.collection_places
        (collection_id, canonical_place_id, position, added_at)
       VALUES ($1::uuid,$2::uuid,$3::int,$4::timestamptz)`,
      [command.collectionId, command.placeId, position, attempt.occurredAt],
    )
    await touchCollection(client, command.collectionId, attempt.occurredAt)
    return 'applied'
  }

  if (command.kind === 'remove-collection-place') {
    if (!await lockOwnedCollection(client, command.collectionId, attempt.memberId)) {
      return 'not-found'
    }
    await client.query(
      `DELETE FROM library.collection_place_import_provenance
       WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
      [command.collectionId, command.placeId],
    )
    const result = await client.query(
      `DELETE FROM library.collection_places
       WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
      [command.collectionId, command.placeId],
    )
    if (result.rowCount !== 1) return 'not-found'
    await touchCollection(client, command.collectionId, attempt.occurredAt)
    return 'applied'
  }

  if (command.kind === 'move-collection-place') {
    if (!await lockOwnedCollection(client, command.collectionId, attempt.memberId)) {
      return 'not-found'
    }
    return moveCollectionPlace(client, {
      collectionId: command.collectionId,
      placeId: command.placeId,
      position: command.position,
      occurredAt: attempt.occurredAt,
    })
  }

  const source = await client.query<{ id: string }>(
    `SELECT id FROM library.collections
     WHERE publication_id = $1::uuid AND visibility IN ('unlisted', 'public')
     FOR SHARE`,
    [command.sourcePublicationId],
  )
  if (source.rows[0] === undefined) return 'not-found'
  await client.query(
    `INSERT INTO library.collections
      (id, owner_membership_id, name, visibility, created_at, updated_at)
     VALUES ($1::uuid,$2::uuid,$3,'private',$4::timestamptz,$4::timestamptz)`,
    [command.targetCollectionId, attempt.memberId, command.targetName, attempt.occurredAt],
  )
  await client.query(
    `INSERT INTO library.collection_places (collection_id, canonical_place_id, position, added_at)
     SELECT $1::uuid, canonical_place_id, position, $3::timestamptz
     FROM library.collection_places WHERE collection_id = $2::uuid`,
    [command.targetCollectionId, source.rows[0].id, attempt.occurredAt],
  )
  await client.query(
    `INSERT INTO library.collection_copy_provenance
      (target_collection_id, source_publication_id, copied_at)
     VALUES ($1::uuid,$2::uuid,$3::timestamptz)`,
    [command.targetCollectionId, command.sourcePublicationId, attempt.occurredAt],
  )
  return 'applied'
}

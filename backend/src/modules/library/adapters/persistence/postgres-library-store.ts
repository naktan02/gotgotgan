import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import type { LibraryStore } from '../../application/ports/library-store.js'
import type {
  ImportedPlaceSaveAttempt,
  ImportedPlaceSaveStore,
} from '../../application/ports/imported-place-save-store.js'
import type {
  LibraryAttempt,
  LibraryCommandOutcome,
  MemberLibrary,
  PlacePreferences,
  PublishedCollection,
} from '../../domain/model.js'

type Receipt = Readonly<{ command_fingerprint: string; outcome: 'applied' | 'not-found' | 'forbidden' }>

export class PostgresLibraryStore implements LibraryStore, ImportedPlaceSaveStore {
  constructor(private readonly pool: Pool) {}

  async saveImportedPlace(attempt: ImportedPlaceSaveAttempt): Promise<LibraryCommandOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('place.library.v1:' || $1, 0))",
        [attempt.commandId],
      )
      const prior = await client.query<Receipt>(
        'SELECT command_fingerprint, outcome FROM library.command_receipts WHERE command_id = $1',
        [attempt.commandId],
      )
      if (prior.rows[0] !== undefined) {
        await client.query('COMMIT')
        return prior.rows[0].command_fingerprint === attempt.fingerprint
          ? { status: 'replayed' }
          : { status: 'conflict' }
      }
      const place = await client.query(
        `SELECT id FROM places.canonical_places
         WHERE id = $1::uuid AND status = 'active'`,
        [attempt.canonicalPlaceId],
      )
      if (place.rows[0] === undefined) {
        await client.query(
          `INSERT INTO library.command_receipts (
             command_id, membership_id, command_kind, command_fingerprint, outcome, occurred_at
           ) VALUES ($1::uuid,$2::uuid,'save-imported-place',$3,'not-found',$4::timestamptz)`,
          [attempt.commandId, attempt.memberId, attempt.fingerprint, attempt.occurredAt],
        )
        await client.query('COMMIT')
        return { status: 'not-found' }
      }

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(
           'place.library.import.v1:' || $1 || ':' || $2 || ':' || $3, 0
         ))`,
        [attempt.source.providerKey, attempt.source.connectionId, attempt.source.listId],
      )
      const mapped = await client.query<{ collection_id: string; owner_membership_id: string }>(
        `SELECT provenance.collection_id, collection.owner_membership_id
         FROM library.collection_import_provenance AS provenance
         JOIN library.collections AS collection ON collection.id = provenance.collection_id
         WHERE provenance.provider_key = $1
           AND provenance.source_connection_reference = $2::uuid
           AND provenance.source_list_id = $3
         FOR UPDATE OF provenance, collection`,
        [attempt.source.providerKey, attempt.source.connectionId, attempt.source.listId],
      )
      const priorCollection = mapped.rows[0]
      if (
        priorCollection !== undefined &&
        priorCollection.owner_membership_id !== attempt.memberId
      ) {
        await client.query(
          `INSERT INTO library.command_receipts (
             command_id, membership_id, command_kind, command_fingerprint, outcome, occurred_at
           ) VALUES ($1::uuid,$2::uuid,'save-imported-place',$3,'forbidden',$4::timestamptz)`,
          [attempt.commandId, attempt.memberId, attempt.fingerprint, attempt.occurredAt],
        )
        await client.query('COMMIT')
        return { status: 'forbidden' }
      }

      const collectionId = priorCollection?.collection_id ?? randomUUID()
      if (priorCollection === undefined) {
        await client.query(
          `INSERT INTO library.collections (
             id, owner_membership_id, name, description, visibility,
             publication_id, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,NULL,'private',NULL,$4::timestamptz,$4::timestamptz)`,
          [collectionId, attempt.memberId, attempt.source.collectionName, attempt.occurredAt],
        )
        await client.query(
          `INSERT INTO library.collection_import_provenance (
             collection_id, owner_membership_id, provider_key,
             source_connection_reference, source_list_id, source_name_snapshot,
             source_position, first_imported_at, last_imported_at
           ) VALUES (
             $1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8::timestamptz,$8::timestamptz
           )`,
          [collectionId, attempt.memberId, attempt.source.providerKey,
            attempt.source.connectionId, attempt.source.listId, attempt.source.listName,
            attempt.source.listPosition, attempt.occurredAt],
        )
      } else {
        await client.query(
          `UPDATE library.collection_import_provenance
           SET source_name_snapshot = $2, source_position = $3,
               last_imported_at = $4::timestamptz
           WHERE collection_id = $1::uuid`,
          [collectionId, attempt.source.listName, attempt.source.listPosition, attempt.occurredAt],
        )
      }

      await client.query(
        `INSERT INTO library.place_preferences (
           membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,true,false,NULL,$3::timestamptz,$3::timestamptz)
         ON CONFLICT (membership_id, canonical_place_id) DO UPDATE
           SET saved = true, updated_at = EXCLUDED.updated_at`,
        [attempt.memberId, attempt.canonicalPlaceId, attempt.occurredAt],
      )
      const placed = await client.query(
        `INSERT INTO library.collection_places (
           collection_id, canonical_place_id, position, added_at
         ) SELECT $1::uuid,$2::uuid,$3,$4::timestamptz
           WHERE NOT EXISTS (
             SELECT 1 FROM library.collection_places
             WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM library.collection_places
             WHERE collection_id = $1::uuid AND position = $3
           )
         ON CONFLICT DO NOTHING`,
        [collectionId, attempt.canonicalPlaceId, attempt.source.position, attempt.occurredAt],
      )
      if (placed.rowCount === 0) {
        await client.query(
          `INSERT INTO library.collection_places (
             collection_id, canonical_place_id, position, added_at
           ) SELECT $1::uuid,$2::uuid,
                    coalesce(max(existing.position) + 1, 0),$3::timestamptz
             FROM library.collection_places AS existing
             WHERE existing.collection_id = $1::uuid
               AND NOT EXISTS (
                 SELECT 1 FROM library.collection_places
                 WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid
               )
           ON CONFLICT DO NOTHING`,
          [collectionId, attempt.canonicalPlaceId, attempt.occurredAt],
        )
      }
      await client.query(
        `UPDATE library.collections
         SET updated_at = greatest(updated_at, $2::timestamptz)
         WHERE id = $1::uuid`,
        [collectionId, attempt.occurredAt],
      )
      const outcome = 'applied' as const
      await client.query(
        `INSERT INTO library.command_receipts (
           command_id, membership_id, command_kind, command_fingerprint, outcome, occurred_at
         ) VALUES ($1::uuid,$2::uuid,'save-imported-place',$3,$4,$5::timestamptz)`,
        [attempt.commandId, attempt.memberId, attempt.fingerprint, outcome, attempt.occurredAt],
      )
      await client.query('COMMIT')
      return { status: outcome }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async apply(attempt: LibraryAttempt): Promise<LibraryCommandOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('place.library.v1:' || $1, 0))", [attempt.commandId])
      const prior = await client.query<Receipt>(
        'SELECT command_fingerprint, outcome FROM library.command_receipts WHERE command_id = $1',
        [attempt.commandId],
      )
      if (prior.rows[0] !== undefined) {
        await client.query('COMMIT')
        return prior.rows[0].command_fingerprint === attempt.fingerprint
          ? { status: 'replayed' }
          : { status: 'conflict' }
      }

      const outcome = await this.applyCommand(client, attempt)
      await client.query(
        `INSERT INTO library.command_receipts
          (command_id, membership_id, command_kind, command_fingerprint, outcome, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [attempt.commandId, attempt.memberId, attempt.command.kind, attempt.fingerprint, outcome, attempt.occurredAt],
      )
      await client.query('COMMIT')
      return { status: outcome }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async applyCommand(
    client: PoolClient,
    attempt: LibraryAttempt,
  ): Promise<'applied' | 'not-found' | 'forbidden'> {
    const command = attempt.command
    if (command.kind === 'set-place-preferences') {
      const prior = await client.query<{ personal_rating: string | null }>(
        `SELECT personal_rating FROM library.place_preferences
         WHERE membership_id = $1 AND canonical_place_id = $2 FOR UPDATE`,
        [attempt.memberId, command.placeId],
      )
      await client.query(
        `INSERT INTO library.place_preferences
          (membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (membership_id, canonical_place_id) DO UPDATE
         SET saved = EXCLUDED.saved, wanted = EXCLUDED.wanted,
             personal_rating = EXCLUDED.personal_rating, updated_at = EXCLUDED.updated_at`,
        [attempt.memberId, command.placeId, command.saved, command.wanted, command.personalRating, attempt.occurredAt],
      )
      const previous = prior.rows[0]?.personal_rating === undefined || prior.rows[0]?.personal_rating === null
        ? null : Number(prior.rows[0].personal_rating)
      if (previous !== command.personalRating) {
        await client.query(
          `INSERT INTO library.personal_rating_events
            (command_id, membership_id, canonical_place_id, previous_rating, next_rating, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [attempt.commandId, attempt.memberId, command.placeId, previous, command.personalRating, attempt.occurredAt],
        )
      }
      return 'applied'
    }
    if (command.kind === 'create-collection') {
      const result = await client.query(
        `INSERT INTO library.collections
          (id, owner_membership_id, name, description, visibility, publication_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT (id) DO NOTHING`,
        [command.collectionId, attempt.memberId, command.name, command.description ?? null,
          command.visibility, command.publicationId ?? null, attempt.occurredAt],
      )
      return result.rowCount === 1 ? 'applied' : 'forbidden'
    }
    if (command.kind === 'add-collection-place') {
      const result = await client.query(
        `INSERT INTO library.collection_places (collection_id, canonical_place_id, position, added_at)
         SELECT id, $3, $4, $5 FROM library.collections
         WHERE id = $1 AND owner_membership_id = $2
         ON CONFLICT (collection_id, canonical_place_id) DO UPDATE SET position = EXCLUDED.position`,
        [command.collectionId, attempt.memberId, command.placeId, command.position, attempt.occurredAt],
      )
      return result.rowCount === 1 ? 'applied' : 'not-found'
    }
    if (command.kind === 'create-tag') {
      const result = await client.query(
        `INSERT INTO library.tags (id, owner_membership_id, name, normalized_name, created_at)
         VALUES ($1,$2,$3,lower(trim($3)),$4) ON CONFLICT DO NOTHING`,
        [command.tagId, attempt.memberId, command.name, attempt.occurredAt],
      )
      return result.rowCount === 1 ? 'applied' : 'forbidden'
    }
    if (command.kind === 'tag-place') {
      const result = await client.query(
        `INSERT INTO library.place_tags (membership_id, canonical_place_id, tag_id, tagged_at)
         SELECT $1, $2, id, $4 FROM library.tags WHERE id = $3 AND owner_membership_id = $1
         ON CONFLICT DO NOTHING`,
        [attempt.memberId, command.placeId, command.tagId, attempt.occurredAt],
      )
      return result.rowCount === 1 ? 'applied' : 'not-found'
    }

    const source = await client.query<{ id: string }>(
      `SELECT id FROM library.collections
       WHERE publication_id = $1 AND visibility IN ('unlisted', 'public')`,
      [command.sourcePublicationId],
    )
    if (source.rows[0] === undefined) return 'not-found'
    await client.query(
      `INSERT INTO library.collections
        (id, owner_membership_id, name, visibility, created_at, updated_at)
       VALUES ($1,$2,$3,'private',$4,$4)`,
      [command.targetCollectionId, attempt.memberId, command.targetName, attempt.occurredAt],
    )
    await client.query(
      `INSERT INTO library.collection_places (collection_id, canonical_place_id, position, added_at)
       SELECT $1, canonical_place_id, position, $3 FROM library.collection_places WHERE collection_id = $2`,
      [command.targetCollectionId, source.rows[0].id, attempt.occurredAt],
    )
    await client.query(
      `INSERT INTO library.collection_copy_provenance
        (target_collection_id, source_publication_id, copied_at) VALUES ($1,$2,$3)`,
      [command.targetCollectionId, command.sourcePublicationId, attempt.occurredAt],
    )
    return 'applied'
  }

  async getPlacePreferences(memberId: string, placeId: string): Promise<PlacePreferences | undefined> {
    const result = await this.pool.query<{
      saved: boolean
      wanted: boolean
      personal_rating: string | null
      updated_at: Date
    }>(
      `SELECT saved, wanted, personal_rating, updated_at FROM library.place_preferences
       WHERE membership_id = $1 AND canonical_place_id = $2`,
      [memberId, placeId],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      memberId,
      placeId,
      saved: row.saved,
      wanted: row.wanted,
      personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  async getPublishedCollection(publicationId: string): Promise<PublishedCollection | undefined> {
    const collection = await this.pool.query<{
      name: string
      description: string | null
      visibility: 'unlisted' | 'public'
      updated_at: Date
      places: { placeId: string; position: number }[]
    }>(
      `SELECT c.name, c.description, c.visibility, c.updated_at,
              coalesce(jsonb_agg(jsonb_build_object(
                'placeId', cp.canonical_place_id, 'position', cp.position
              ) ORDER BY cp.position) FILTER (WHERE cp.canonical_place_id IS NOT NULL), '[]') AS places
       FROM library.collections c
       LEFT JOIN library.collection_places cp ON cp.collection_id = c.id
       WHERE c.publication_id = $1 AND c.visibility IN ('unlisted', 'public')
       GROUP BY c.id`,
      [publicationId],
    )
    const row = collection.rows[0]
    if (row === undefined) return undefined
    return {
      publicationId,
      visibility: row.visibility,
      name: row.name,
      description: row.description,
      places: row.places,
      updatedAt: row.updated_at.toISOString(),
    }
  }

  async getMemberLibrary(memberId: string): Promise<MemberLibrary> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const preferences = await client.query<{ canonical_place_id: string; saved: boolean; wanted: boolean; personal_rating: string | null; updated_at: Date }>(
          `SELECT canonical_place_id, saved, wanted, personal_rating, updated_at
           FROM library.place_preferences WHERE membership_id = $1 ORDER BY updated_at DESC, canonical_place_id`, [memberId],
        )
      const collections = await client.query<{ id: string; name: string; description: string | null; visibility: 'private' | 'unlisted' | 'public'; publication_id: string | null; updated_at: Date; places: { placeId: string; position: number }[] }>(
          `SELECT c.id, c.name, c.description, c.visibility, c.publication_id, c.updated_at,
                  coalesce(jsonb_agg(jsonb_build_object('placeId', cp.canonical_place_id, 'position', cp.position)
                    ORDER BY cp.position) FILTER (WHERE cp.canonical_place_id IS NOT NULL), '[]') AS places
           FROM library.collections c LEFT JOIN library.collection_places cp ON cp.collection_id = c.id
           WHERE c.owner_membership_id = $1 GROUP BY c.id ORDER BY c.updated_at DESC, c.id`, [memberId],
        )
      const tags = await client.query<{ id: string; name: string; place_ids: string[] }>(
          `SELECT t.id, t.name, coalesce(array_agg(pt.canonical_place_id ORDER BY pt.canonical_place_id)
             FILTER (WHERE pt.canonical_place_id IS NOT NULL), '{}') AS place_ids
           FROM library.tags t LEFT JOIN library.place_tags pt ON pt.tag_id = t.id AND pt.membership_id = t.owner_membership_id
           WHERE t.owner_membership_id = $1 GROUP BY t.id ORDER BY t.normalized_name, t.id`, [memberId],
        )
      await client.query('COMMIT')
      return {
        places: preferences.rows.map((row) => ({ memberId, placeId: row.canonical_place_id, saved: row.saved, wanted: row.wanted, personalRating: row.personal_rating === null ? null : Number(row.personal_rating), updatedAt: row.updated_at.toISOString() })),
        collections: collections.rows.map((row) => ({ collectionId: row.id, name: row.name, description: row.description, visibility: row.visibility, publicationId: row.publication_id, places: row.places, updatedAt: row.updated_at.toISOString() })),
        tags: tags.rows.map((row) => ({ tagId: row.id, name: row.name, placeIds: row.place_ids })),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

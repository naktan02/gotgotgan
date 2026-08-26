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
      const saved = await client.query(
        `INSERT INTO library.place_preferences (
           membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at
         ) SELECT $1::uuid, place.id, true, false, NULL, $3::timestamptz, $3::timestamptz
           FROM places.canonical_places AS place
           WHERE place.id = $2::uuid AND place.status = 'active'
         ON CONFLICT (membership_id, canonical_place_id) DO UPDATE
           SET saved = true, updated_at = EXCLUDED.updated_at`,
        [attempt.memberId, attempt.canonicalPlaceId, attempt.occurredAt],
      )
      const outcome = saved.rowCount === 1 ? 'applied' as const : 'not-found' as const
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

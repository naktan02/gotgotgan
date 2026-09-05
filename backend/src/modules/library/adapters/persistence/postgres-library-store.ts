import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import type { LibraryStore } from '../../application/ports/library-store.js'
import type {
  ImportedPlaceSaveAttempt,
  ImportedPlaceSaveStore,
} from '../../application/ports/imported-place-save-store.js'
import type {
  LibraryAttempt,
  LibraryCommandOutcome,
  PlacePreferences,
} from '../../domain/model.js'
import { applyPostgresLibraryCommand } from './postgres-library-command-writes.js'
import { lockPostgresPlacePreference } from './postgres-library-preference-writes.js'

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
      await client.query(
        `INSERT INTO transfers.import_sources (
           id, owner_membership_id, provider_key, source_kind, connection_id, created_at
         ) VALUES ($1::uuid,$2::uuid,$3,'legacy-reference',NULL,$4::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [attempt.source.connectionId, attempt.memberId,
          attempt.source.providerKey, attempt.occurredAt],
      )
      const importSource = (await client.query<{
        source_kind: 'verified-connection' | 'legacy-reference'
        connection_id: string | null
      }>(
        `SELECT source_kind, connection_id
         FROM transfers.import_sources
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid AND provider_key = $3
           AND source_kind IN ('verified-connection','legacy-reference')`,
        [attempt.source.connectionId, attempt.memberId, attempt.source.providerKey],
      )).rows[0]
      if (importSource === undefined) throw new Error('legacy import source identity is unavailable')
      const mapped = await client.query<{ collection_id: string; owner_membership_id: string }>(
        `SELECT provenance.collection_id, collection.owner_membership_id
         FROM library.collection_import_provenance AS provenance
         JOIN library.collections AS collection ON collection.id = provenance.collection_id
         WHERE provenance.provider_key = $1
           AND provenance.import_source_id = $2::uuid
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
             import_source_id, import_source_kind, source_connection_reference,
             source_list_id, source_name_snapshot, source_position,
             first_imported_at, last_imported_at
           ) VALUES (
             $1::uuid,$2::uuid,$3,$4::uuid,$5,$6::uuid,$7,$8,$9,
             $10::timestamptz,$10::timestamptz
           )`,
          [collectionId, attempt.memberId, attempt.source.providerKey,
            attempt.source.connectionId, importSource.source_kind, importSource.connection_id,
            attempt.source.listId, attempt.source.listName,
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

      await lockPostgresPlacePreference(
        client,
        attempt.memberId,
        attempt.canonicalPlaceId,
      )
      await client.query(
        `INSERT INTO library.place_preferences (
           membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,true,false,NULL,$3::timestamptz,$3::timestamptz)
         ON CONFLICT (membership_id, canonical_place_id) DO UPDATE
           SET saved = true,
               updated_at = greatest(
                 EXCLUDED.updated_at,
                 library.place_preferences.updated_at + interval '1 millisecond'
               )`,
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
         ON CONFLICT (collection_id, canonical_place_id) DO NOTHING`,
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
           ON CONFLICT (collection_id, canonical_place_id) DO NOTHING`,
          [collectionId, attempt.canonicalPlaceId, attempt.occurredAt],
        )
      }
      await client.query(
        `INSERT INTO library.collection_place_import_provenance (
           collection_id, canonical_place_id, provider_key,
           import_source_id, import_source_kind, source_connection_reference,
           owner_membership_id, source_list_id, source_item_id, provider_place_id,
           first_imported_at, last_imported_at
         ) VALUES (
           $1::uuid,$2::uuid,$3,$4::uuid,$5,$6::uuid,$9::uuid,$7,$8,$10,
           $11::timestamptz,$11::timestamptz
         )
         ON CONFLICT (
           provider_key, import_source_id, source_list_id, source_item_id
         ) DO UPDATE
         SET collection_id = EXCLUDED.collection_id,
             canonical_place_id = EXCLUDED.canonical_place_id,
             provider_place_id = EXCLUDED.provider_place_id,
             last_imported_at = EXCLUDED.last_imported_at`,
        [collectionId, attempt.canonicalPlaceId, attempt.source.providerKey,
          attempt.source.connectionId, importSource.source_kind, importSource.connection_id,
          attempt.source.listId, attempt.source.itemId, attempt.memberId,
          attempt.source.providerPlaceId, attempt.occurredAt],
      )
      await client.query(
        `UPDATE library.collections
         SET revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
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

      const outcome = await applyPostgresLibraryCommand(client, attempt)
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

}

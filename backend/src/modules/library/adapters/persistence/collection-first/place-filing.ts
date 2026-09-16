import type { Pool, PoolClient } from 'pg'

import { decodePlaceFilingCursor, encodePlaceFilingCursor } from '../../../application/collection-first-cursor.js'
import { collectionVersion, readCollectionRevision } from '../../../application/collection-version.js'
import type { PlaceFiling } from '../../../application/ports/collection-first.js'
import type {
  LibraryWriteResult,
  OpaqueVersion,
  PlaceFilingMutation,
  PlaceFilingReceipt,
} from '../../../domain/collection-first.js'
import {
  libraryOperationFingerprint,
  lockLibraryOperation,
  readPriorLibraryOperation,
  recordAppliedLibraryOperation,
  recordRejectedLibraryOperation,
} from '../postgres-library-operation-receipts.js'

type FilingRow = Readonly<{
  id: string
  name: string
  included: boolean
  revision: string
  updated_at: Date
}>

async function readPlaceOverlay(client: PoolClient, memberId: string, placeId: string) {
  const result = await client.query<{ collection_count: number; personal_rating: string | null }>(
    `SELECT
       (SELECT count(*)::int FROM library.collection_places AS placed
        JOIN library.collections AS collection ON collection.id = placed.collection_id
        WHERE collection.owner_membership_id = $1::uuid
          AND placed.canonical_place_id = $2::uuid) AS collection_count,
       (SELECT personal_rating FROM library.place_preferences
        WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid) AS personal_rating`,
    [memberId, placeId],
  )
  const row = result.rows[0]!
  return {
    collectionMembershipCount: row.collection_count,
    personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
  }
}

export class PostgresPlaceFiling implements PlaceFiling {
  constructor(private readonly pool: Pool) {}

  async open(query: Parameters<PlaceFiling['open']>[0]) {
    const cursor = decodePlaceFilingCursor(query.cursor, query.memberId, query.placeId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const place = await client.query(
        `SELECT id FROM places.canonical_places WHERE id = $1::uuid AND status = 'active'`,
        [query.placeId],
      )
      if (place.rows[0] === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      const [collections, overlay] = await Promise.all([
        client.query<FilingRow>(
          `SELECT collection.id, collection.name,
                  (placed.canonical_place_id IS NOT NULL) AS included,
                  collection.revision::text, collection.updated_at
           FROM library.collections AS collection
           LEFT JOIN library.collection_places AS placed
             ON placed.collection_id = collection.id AND placed.canonical_place_id = $2::uuid
           WHERE collection.owner_membership_id = $1::uuid
             AND ($3::timestamptz IS NULL OR collection.updated_at < $3::timestamptz
               OR (collection.updated_at = $3::timestamptz AND collection.id > $4::uuid))
           ORDER BY collection.updated_at DESC, collection.id ASC LIMIT $5`,
          [query.memberId, query.placeId, cursor?.updatedAt ?? null,
            cursor?.collectionId ?? null, query.limit + 1],
        ),
        readPlaceOverlay(client, query.memberId, query.placeId),
      ])
      await client.query('COMMIT')
      const hasMore = collections.rows.length > query.limit
      const rows = collections.rows.slice(0, query.limit)
      const last = rows.at(-1)
      return {
        schemaVersion: 'place-filing.v2' as const,
        placeId: query.placeId,
        ...overlay,
        collections: rows.map((row) => ({
          collectionId: row.id, name: row.name, included: row.included,
          version: collectionVersion(row.id, row.revision),
        })),
        ...(hasMore && last !== undefined ? {
          nextCursor: encodePlaceFilingCursor(query.memberId, query.placeId, {
            updatedAt: last.updated_at.toISOString(), collectionId: last.id,
          }),
        } : {}),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async apply(mutation: PlaceFilingMutation): Promise<LibraryWriteResult<PlaceFilingReceipt>> {
    const kind = 'place-filing'
    const { context, ...payload } = mutation
    const fingerprint = libraryOperationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockLibraryOperation(client, context.operationId)
      const prior = await readPriorLibraryOperation<PlaceFilingReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      const place = await client.query(
        `SELECT id FROM places.canonical_places WHERE id = $1::uuid AND status = 'active'`,
        [mutation.placeId],
      )
      const sorted = [...mutation.changes].sort((left, right) =>
        left.collectionId.localeCompare(right.collectionId))
      const locked = place.rows[0] === undefined ? { rows: [] } : await client.query<{
        id: string; revision: string
      }>(
        `SELECT id, revision::text FROM library.collections
         WHERE owner_membership_id = $1::uuid AND id = ANY($2::uuid[])
         ORDER BY id ASC FOR UPDATE`,
        [context.memberId, sorted.map((change) => change.collectionId)],
      )
      if (place.rows[0] === undefined || locked.rows.length !== sorted.length) {
        const result = await recordRejectedLibraryOperation<PlaceFilingReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
        await client.query('COMMIT')
        return result
      }
      const revisions = new Map(locked.rows.map((row) => [row.id, row.revision]))
      if (sorted.some((change) => readCollectionRevision(change.expectedVersion, change.collectionId) !==
        revisions.get(change.collectionId))) {
        const result = await recordRejectedLibraryOperation<PlaceFilingReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
        })
        await client.query('COMMIT')
        return result
      }
      const responseCollections: Array<{
        collectionId: string; included: boolean; version: OpaqueVersion
      }> = []
      for (const change of sorted) {
        const membership = await client.query(
          `SELECT position FROM library.collection_places
           WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
          [change.collectionId, mutation.placeId],
        )
        const included = membership.rows[0] !== undefined
        let changed = false
        if (change.desired === 'included' && !included) {
          await client.query(
            `INSERT INTO library.collection_places (collection_id, canonical_place_id, position, added_at)
             SELECT $1::uuid,$2::uuid,coalesce(max(position) + 1, 0),$3::timestamptz
             FROM library.collection_places WHERE collection_id = $1::uuid`,
            [change.collectionId, mutation.placeId, context.occurredAt],
          )
          changed = true
        } else if (change.desired === 'excluded' && included) {
          await client.query(
            `DELETE FROM library.collection_place_import_provenance
             WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
            [change.collectionId, mutation.placeId],
          )
          await client.query(
            `DELETE FROM library.collection_places
             WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
            [change.collectionId, mutation.placeId],
          )
          changed = true
        }
        let revision = revisions.get(change.collectionId)!
        if (changed) {
          const updated = await client.query<{ revision: string }>(
            `UPDATE library.collections SET revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
             WHERE id = $1::uuid RETURNING revision::text`,
            [change.collectionId, context.occurredAt],
          )
          revision = updated.rows[0]!.revision
        }
        responseCollections.push({
          collectionId: change.collectionId,
          included: change.desired === 'included',
          version: collectionVersion(change.collectionId, revision),
        })
      }
      const overlay = await readPlaceOverlay(client, context.memberId, mutation.placeId)
      const value: PlaceFilingReceipt = {
        placeId: mutation.placeId, ...overlay, collections: responseCollections,
      }
      const result = await recordAppliedLibraryOperation(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
        occurredAt: context.occurredAt, value,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

import type { Pool } from 'pg'

import { readCollectionRevision } from '../../../application/collection-version.js'
import type { CollectionLifecycle } from '../../../application/ports/collection-first.js'
import type {
  CollectionLifecycleCommand,
  CollectionLifecycleReceipt,
  LibraryWriteResult,
} from '../../../domain/collection-first.js'
import {
  libraryOperationFingerprint,
  lockLibraryOperation,
  readPriorLibraryOperation,
  recordAppliedLibraryOperation,
  recordRejectedLibraryOperation,
} from '../postgres-library-operation-receipts.js'
import { type CollectionRow, toCollectionWorkspaceSummary } from './collection-record.js'

export class PostgresCollectionLifecycle implements CollectionLifecycle {
  constructor(private readonly pool: Pool) {}

  async apply(
    input: CollectionLifecycleCommand,
  ): Promise<LibraryWriteResult<CollectionLifecycleReceipt>> {
    const kind = `collection-${input.kind}`
    const { context, ...payload } = input
    const fingerprint = libraryOperationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockLibraryOperation(client, context.operationId)
      const prior = await readPriorLibraryOperation<CollectionLifecycleReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      let value: CollectionLifecycleReceipt
      if (input.kind === 'create') {
        const created = await client.query<CollectionRow>(
          `INSERT INTO library.collections (
             id, owner_membership_id, name, description, visibility, publication_id,
             revision, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4,'private',NULL,1,$5::timestamptz,$5::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, name, description, visibility, publication_id,
                     0::int AS place_count, revision::text, updated_at`,
          [input.collectionId, context.memberId, input.name, input.description, context.occurredAt],
        )
        if (created.rows[0] === undefined) {
          const result = await recordRejectedLibraryOperation<CollectionLifecycleReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'not-found' },
          })
          await client.query('COMMIT')
          return result
        }
        value = { collection: toCollectionWorkspaceSummary(created.rows[0]) }
      } else {
        const current = await client.query<CollectionRow>(
          `SELECT collection.id, collection.name, collection.description, collection.visibility,
                  collection.publication_id,
                  (SELECT count(*)::int FROM library.collection_places AS placed
                   WHERE placed.collection_id = collection.id) AS place_count,
                  collection.revision::text, collection.updated_at
           FROM library.collections AS collection
           WHERE collection.id = $1::uuid AND collection.owner_membership_id = $2::uuid FOR UPDATE`,
          [input.collectionId, context.memberId],
        )
        const row = current.rows[0]
        if (row === undefined) {
          const result = await recordRejectedLibraryOperation<CollectionLifecycleReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'not-found' },
          })
          await client.query('COMMIT')
          return result
        }
        if (readCollectionRevision(input.expectedVersion, input.collectionId) !== row.revision) {
          const result = await recordRejectedLibraryOperation<CollectionLifecycleReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
          })
          await client.query('COMMIT')
          return result
        }
        if (input.kind === 'delete') {
          await client.query(
            'DELETE FROM library.collection_place_import_provenance WHERE collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collection_import_provenance WHERE collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collection_copy_provenance WHERE target_collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collection_places WHERE collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collections WHERE id = $1::uuid AND owner_membership_id = $2::uuid',
            [input.collectionId, context.memberId],
          )
          value = { collection: null }
        } else {
          const visibility = input.visibility ?? row.visibility
          const updated = await client.query<CollectionRow>(
            `UPDATE library.collections
             SET name = coalesce($3::text, name),
                 description = CASE WHEN $4::boolean THEN $5::text ELSE description END,
                 visibility = $6,
                 publication_id = CASE
                   WHEN $6 = 'private' THEN NULL
                   WHEN visibility = 'private' THEN gen_random_uuid()
                   ELSE publication_id END,
                 revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $7::timestamptz)
             WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             RETURNING id, name, description, visibility, publication_id,
                       $8::int AS place_count, revision::text, updated_at`,
            [input.collectionId, context.memberId, input.name ?? null,
              input.description !== undefined, input.description ?? null,
              visibility, context.occurredAt, row.place_count],
          )
          value = { collection: toCollectionWorkspaceSummary(updated.rows[0]!) }
        }
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

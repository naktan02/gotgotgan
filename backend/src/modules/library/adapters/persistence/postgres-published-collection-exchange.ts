import type { Pool, PoolClient } from 'pg'

import { collectionVersion, readCollectionRevision } from '../../application/collection-version.js'
import type { PublishedCollectionExchange } from '../../application/ports/collection-first.js'
import type {
  CollectionPublicationReceipt,
  LibraryWriteRejection,
  LibraryWriteResult,
  PublishedCollectionCopy,
  PublishedCollectionCopyReceipt,
} from '../../domain/collection-first.js'
import {
  libraryOperationFingerprint,
  lockLibraryOperation,
  readPriorLibraryOperation,
  recordAppliedLibraryOperation,
  recordRejectedLibraryOperation,
} from './postgres-library-operation-receipts.js'

type SourceRow = Readonly<{
  id: string
  revision: string
}>

type SourcePlaceRow = Readonly<{
  canonical_place_id: string
  position: number
}>

const maximumCopiedPlaceCount = 1_000

async function rejected<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
    occurredAt: string
    rejection: LibraryWriteRejection
  }>,
) {
  const result = await recordRejectedLibraryOperation<Value>(client, input)
  await client.query('COMMIT')
  return result
}

/**
 * Copies only source membership identities and their relative order. This adapter intentionally
 * cannot read ratings, Tags, visits, writing, or media tables.
 */
export class PostgresPublishedCollectionExchange implements PublishedCollectionExchange {
  constructor(private readonly pool: Pool) {}

  async copy(input: PublishedCollectionCopy): Promise<LibraryWriteResult<PublishedCollectionCopyReceipt>> {
    const { context } = input
    const kind = 'copy-published-collection.v2'
    const payload = {
      publicationId: input.publicationId,
      expectedPublicationVersion: input.expectedPublicationVersion,
      targetCollectionId: input.targetCollectionId,
      targetName: input.targetName,
      selection: input.selection.kind === 'all'
        ? input.selection
        : { kind: input.selection.kind, placeIds: [...input.selection.placeIds].sort() },
    }
    const fingerprint = libraryOperationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockLibraryOperation(client, context.operationId)
      const prior = await readPriorLibraryOperation<PublishedCollectionCopyReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }

      const source = await client.query<SourceRow>(
        `SELECT collection.id, collection.revision::text
         FROM library.collections AS collection
         JOIN profiles.public_profiles AS profile
           ON profile.membership_id = collection.owner_membership_id
          AND profile.visibility = 'public'
         LEFT JOIN profiles.public_profile_moderation AS moderation
           ON moderation.handle = profile.handle
         WHERE collection.publication_id = $1::uuid
           AND collection.visibility = 'public'
           AND coalesce(moderation.state, 'allowed') = 'allowed'
         FOR SHARE OF collection, profile`,
        [input.publicationId],
      )
      const sourceRow = source.rows[0]
      if (sourceRow === undefined) {
        return rejected(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
      }
      if (
        readCollectionRevision(input.expectedPublicationVersion, sourceRow.id) !== sourceRow.revision
      ) {
        return rejected(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'publication-changed' },
        })
      }

      const selectedIds = input.selection.kind === 'places' ? [...input.selection.placeIds] : []
      const selected = await client.query<SourcePlaceRow>(
        `SELECT canonical_place_id, position
         FROM library.collection_places
         WHERE collection_id = $1::uuid
           AND ($2::boolean OR canonical_place_id = ANY($3::uuid[]))
         ORDER BY position, canonical_place_id
         LIMIT $4`,
        [sourceRow.id, input.selection.kind === 'all', selectedIds, maximumCopiedPlaceCount + 1],
      )
      if (
        input.selection.kind === 'places' && selected.rows.length !== input.selection.placeIds.length
      ) {
        return rejected(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'invalid-selection' },
        })
      }
      if (selected.rows.length > maximumCopiedPlaceCount) {
        return rejected(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt,
          rejection: { code: 'collection-limit-exceeded', limit: maximumCopiedPlaceCount },
        })
      }

      const created = await client.query(
        `INSERT INTO library.collections (
           id, owner_membership_id, name, description, visibility, publication_id,
           created_at, updated_at, revision
         ) VALUES ($1::uuid,$2::uuid,$3,NULL,'private',NULL,$4::timestamptz,$4::timestamptz,1)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [input.targetCollectionId, context.memberId, input.targetName, context.occurredAt],
      )
      if (created.rows[0] === undefined) {
        return rejected(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
      }
      if (selected.rows.length > 0) {
        await client.query(
          `INSERT INTO library.collection_places (
             collection_id, canonical_place_id, position, added_at
           )
           SELECT $1::uuid, copied.canonical_place_id, copied.ordinality::int - 1,
                  $3::timestamptz
           FROM unnest($2::uuid[]) WITH ORDINALITY AS copied(canonical_place_id, ordinality)`,
          [input.targetCollectionId, selected.rows.map((row) => row.canonical_place_id),
            context.occurredAt],
        )
      }

      const value: PublishedCollectionCopyReceipt = {
        collectionId: input.targetCollectionId,
        version: collectionVersion(input.targetCollectionId, 1),
        copiedPlaceCount: selected.rows.length,
      }
      const result = await recordAppliedLibraryOperation(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
        occurredAt: context.occurredAt, value,
      })
      await client.query(
        `INSERT INTO library.publication_copy_operations (
           operation_id, source_publication_id, source_collection_revision,
           target_collection_id, selection_kind, copied_at
         ) VALUES ($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5,$6::timestamptz)`,
        [context.operationId, input.publicationId, sourceRow.revision,
          input.targetCollectionId, input.selection.kind, context.occurredAt],
      )
      if (selected.rows.length > 0) {
        await client.query(
          `INSERT INTO library.publication_copy_items (
             operation_id, canonical_place_id, source_position
           )
           SELECT $1::uuid, copied.canonical_place_id, copied.source_position
           FROM unnest($2::uuid[], $3::int[]) AS copied(canonical_place_id, source_position)`,
          [context.operationId, selected.rows.map((row) => row.canonical_place_id),
            selected.rows.map((row) => row.position)],
        )
      }
      await client.query(
        `INSERT INTO library.collection_copy_provenance (
           target_collection_id, source_publication_id, copied_at
         ) VALUES ($1::uuid,$2::uuid,$3::timestamptz)`,
        [input.targetCollectionId, input.publicationId, context.occurredAt],
      )
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async setPublication(
    input: Parameters<PublishedCollectionExchange['setPublication']>[0],
  ): Promise<LibraryWriteResult<CollectionPublicationReceipt>> {
    const { context } = input
    const kind = 'set-collection-publication.v2'
    const payload = {
      collectionId: input.collectionId,
      expectedVersion: input.expectedVersion,
      visibility: input.visibility,
    }
    const fingerprint = libraryOperationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockLibraryOperation(client, context.operationId)
      const prior = await readPriorLibraryOperation<CollectionPublicationReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      const current = await client.query<{
        revision: string
        visibility: 'private' | 'unlisted' | 'public'
      }>(
        `SELECT revision::text, visibility FROM library.collections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [input.collectionId, context.memberId],
      )
      const row = current.rows[0]
      if (row === undefined) {
        return rejected<CollectionPublicationReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
      }
      if (readCollectionRevision(input.expectedVersion, input.collectionId) !== row.revision) {
        return rejected<CollectionPublicationReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
        })
      }
      const updated = await client.query<{
        publication_id: string | null
        visibility: 'private' | 'unlisted' | 'public'
        revision: string
      }>(
        `UPDATE library.collections
         SET visibility = $3,
             publication_id = CASE
               WHEN $3 = 'private' THEN NULL
               WHEN visibility = 'private' THEN gen_random_uuid()
               ELSE publication_id
             END,
             revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid
         RETURNING publication_id, visibility, revision::text`,
        [input.collectionId, context.memberId, input.visibility, context.occurredAt],
      )
      const changed = updated.rows[0]!
      const value: CollectionPublicationReceipt = {
        collectionId: input.collectionId,
        publicationId: changed.publication_id,
        visibility: changed.visibility,
        version: collectionVersion(input.collectionId, changed.revision),
      }
      const result = await recordAppliedLibraryOperation<CollectionPublicationReceipt>(client, {
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

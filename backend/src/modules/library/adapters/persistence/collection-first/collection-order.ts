import type { Pool } from 'pg'

import { collectionVersion, readCollectionRevision } from '../../../application/collection-version.js'
import type { CollectionOrder } from '../../../application/ports/collection-first.js'
import type {
  CollectionOrderMove,
  CollectionOrderReceipt,
  LibraryWriteResult,
} from '../../../domain/collection-first.js'
import {
  libraryOperationFingerprint,
  lockLibraryOperation,
  readPriorLibraryOperation,
  recordAppliedLibraryOperation,
  recordRejectedLibraryOperation,
} from '../postgres-library-operation-receipts.js'

export class PostgresCollectionOrder implements CollectionOrder {
  constructor(private readonly pool: Pool) {}

  async move(input: CollectionOrderMove): Promise<LibraryWriteResult<CollectionOrderReceipt>> {
    const kind = 'collection-order'
    const { context, ...payload } = input
    const fingerprint = libraryOperationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockLibraryOperation(client, context.operationId)
      const prior = await readPriorLibraryOperation<CollectionOrderReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      const collection = await client.query<{ revision: string }>(
        `SELECT revision::text FROM library.collections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [input.collectionId, context.memberId],
      )
      const currentRevision = collection.rows[0]?.revision
      if (currentRevision === undefined) {
        const result = await recordRejectedLibraryOperation<CollectionOrderReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
        await client.query('COMMIT')
        return result
      }
      if (readCollectionRevision(input.expectedVersion, input.collectionId) !== currentRevision) {
        const result = await recordRejectedLibraryOperation<CollectionOrderReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
        })
        await client.query('COMMIT')
        return result
      }
      const current = await client.query<{ position: number }>(
        `SELECT position FROM library.collection_places
         WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
        [input.collectionId, input.placeId],
      )
      if (current.rows[0] === undefined) {
        const result = await recordRejectedLibraryOperation<CollectionOrderReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'source-membership-missing' },
        })
        await client.query('COMMIT')
        return result
      }
      let targetPosition: number
      if (input.placement.kind === 'first') targetPosition = 0
      else if (input.placement.kind === 'last') {
        targetPosition = Number((await client.query<{ position: number }>(
          `SELECT coalesce(max(position), 0)::int AS position
           FROM library.collection_places WHERE collection_id = $1::uuid`,
          [input.collectionId],
        )).rows[0]!.position)
      } else {
        const anchor = await client.query<{ position: number }>(
          `SELECT position FROM library.collection_places
           WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
          [input.collectionId, input.placement.placeId],
        )
        if (anchor.rows[0] === undefined) {
          const result = await recordRejectedLibraryOperation<CollectionOrderReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'anchor-not-found' },
          })
          await client.query('COMMIT')
          return result
        }
        const anchorPosition = anchor.rows[0].position
        const currentPosition = current.rows[0].position
        targetPosition = input.placement.kind === 'before'
          ? anchorPosition - (currentPosition < anchorPosition ? 1 : 0)
          : anchorPosition + (currentPosition > anchorPosition ? 1 : 0)
      }
      const currentPosition = current.rows[0].position
      if (targetPosition !== currentPosition) {
        await client.query('SET CONSTRAINTS library.collection_places_position_unique DEFERRED')
        await client.query(
          `UPDATE library.collection_places SET position = CASE
             WHEN canonical_place_id = $2::uuid THEN $4::int
             WHEN $4::int < $3::int THEN position + 1 ELSE position - 1 END
           WHERE collection_id = $1::uuid AND (
             canonical_place_id = $2::uuid
             OR ($4::int < $3::int AND position >= $4::int AND position < $3::int)
             OR ($4::int > $3::int AND position > $3::int AND position <= $4::int))`,
          [input.collectionId, input.placeId, currentPosition, targetPosition],
        )
      }
      const updated = await client.query<{ revision: string }>(
        `UPDATE library.collections SET revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
         WHERE id = $1::uuid RETURNING revision::text`,
        [input.collectionId, context.occurredAt],
      )
      const value: CollectionOrderReceipt = {
        collectionId: input.collectionId,
        placeId: input.placeId,
        version: collectionVersion(input.collectionId, updated.rows[0]!.revision),
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

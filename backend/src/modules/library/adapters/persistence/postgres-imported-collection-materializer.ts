import type { Pool } from 'pg'

import { collectionVersion, readCollectionRevision } from '../../application/collection-version.js'
import type { ImportedCollectionMaterializer } from '../../application/ports/collection-first.js'
import {
  type ImportedCollectionMaterialization,
  type ImportedCollectionReceipt,
  type LibraryWriteResult,
  type OpaqueVersion,
} from '../../domain/collection-first.js'
import {
  libraryOperationFingerprint,
  lockLibraryOperation,
  readPriorLibraryOperation,
  recordAppliedLibraryOperation,
  recordRejectedLibraryOperation,
} from './postgres-library-operation-receipts.js'

const bindingVersionPrefix = 'import-binding-revision.v1.'

function bindingVersion(input: Readonly<{
  providerKey: string
  connectionId: string
  sourceListId: string
  revision: string
}>): OpaqueVersion {
  const payload = Buffer.from(JSON.stringify({ v: 1, ...input }), 'utf8').toString('base64url')
  return `${bindingVersionPrefix}${payload}` as OpaqueVersion
}

function readBindingRevision(
  value: OpaqueVersion,
  identity: Readonly<{ providerKey: string; connectionId: string; sourceListId: string }>,
): string | undefined {
  if (!value.startsWith(bindingVersionPrefix)) return undefined
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice(bindingVersionPrefix.length), 'base64url').toString('utf8'),
    )
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    if (
      record.v !== 1 || record.providerKey !== identity.providerKey ||
      record.connectionId !== identity.connectionId || record.sourceListId !== identity.sourceListId ||
      !/^\d+$/.test(String(record.revision))
    ) return undefined
    return String(record.revision)
  } catch {
    return undefined
  }
}

type BindingRow = Readonly<{
  collection_id: string
  binding_revision: string
}>

/**
 * Applies only canonical Place identities and source order. Personal annotations are not accepted
 * by the port and therefore cannot cross the import boundary.
 */
export class PostgresImportedCollectionMaterializer implements ImportedCollectionMaterializer {
  constructor(private readonly pool: Pool) {}

  async materialize(
    input: ImportedCollectionMaterialization,
  ): Promise<LibraryWriteResult<ImportedCollectionReceipt>> {
    const kind = 'imported-collection-materialization'
    const { context, ...payload } = input
    const fingerprint = libraryOperationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockLibraryOperation(client, context.operationId)
      const prior = await readPriorLibraryOperation<ImportedCollectionReceipt>(client, {
        operationId: context.operationId,
        memberId: context.memberId,
        kind,
        fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }

      const binding = (await client.query<BindingRow>(
        `SELECT collection_id, binding_revision::text
         FROM library.import_source_list_bindings
         WHERE provider_key = $1
           AND source_connection_reference = $2::uuid
           AND source_list_id = $3
         FOR UPDATE`,
        [input.source.providerKey, input.source.connectionId, input.source.sourceListId],
      )).rows[0]
      if (binding !== undefined && binding.collection_id !== input.target.collectionId) {
        const rejected = await recordRejectedLibraryOperation<ImportedCollectionReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'binding-version-conflict' },
        })
        await client.query('COMMIT')
        return rejected
      }
      if (input.expectedBindingVersion !== undefined && (
        binding === undefined || readBindingRevision(input.expectedBindingVersion, {
          providerKey: input.source.providerKey,
          connectionId: input.source.connectionId,
          sourceListId: input.source.sourceListId,
        }) !== binding.binding_revision
      )) {
        const rejected = await recordRejectedLibraryOperation<ImportedCollectionReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'binding-version-conflict' },
        })
        await client.query('COMMIT')
        return rejected
      }

      let collectionRevision: string
      let created = false
      if (input.target.kind === 'new' && binding === undefined) {
        const inserted = await client.query<{ revision: string }>(
          `INSERT INTO library.collections (
             id, owner_membership_id, name, description, visibility, publication_id,
             revision, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,NULL,'private',NULL,1,$4::timestamptz,$4::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING revision::text`,
          [input.target.collectionId, context.memberId, input.target.name, context.occurredAt],
        )
        if (inserted.rows[0] === undefined) {
          const rejected = await recordRejectedLibraryOperation<ImportedCollectionReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'not-found' },
          })
          await client.query('COMMIT')
          return rejected
        }
        collectionRevision = inserted.rows[0].revision
        created = true
      } else {
        const collection = await client.query<{ revision: string }>(
          `SELECT revision::text FROM library.collections
           WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
          [input.target.collectionId, context.memberId],
        )
        const row = collection.rows[0]
        if (row === undefined) {
          const rejected = await recordRejectedLibraryOperation<ImportedCollectionReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'not-found' },
          })
          await client.query('COMMIT')
          return rejected
        }
        if (
          input.target.kind === 'existing' &&
          readCollectionRevision(input.target.expectedVersion, input.target.collectionId) !== row.revision
        ) {
          const rejected = await recordRejectedLibraryOperation<ImportedCollectionReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
          })
          await client.query('COMMIT')
          return rejected
        }
        collectionRevision = row.revision
      }

      const uniquePlaceIds = [...new Set(input.items.map((item) => item.placeId))]
      const existingPlaces = await client.query<{ id: string }>(
        'SELECT id FROM places.canonical_places WHERE id = ANY($1::uuid[])',
        [uniquePlaceIds],
      )
      if (existingPlaces.rows.length !== uniquePlaceIds.length) {
        const rejected = await recordRejectedLibraryOperation<ImportedCollectionReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'invalid-selection' },
        })
        await client.query('COMMIT')
        return rejected
      }

      let membershipChanged = false
      let nextPosition = Number((await client.query<{ next_position: number }>(
        `SELECT coalesce(max(position) + 1, 0)::int AS next_position
         FROM library.collection_places WHERE collection_id = $1::uuid`,
        [input.target.collectionId],
      )).rows[0]!.next_position)
      const orderedItems = [...input.items].sort((left, right) => (
        left.sourcePosition - right.sourcePosition || left.sourceItemId.localeCompare(right.sourceItemId)
      ))
      const placed = new Set<string>()
      for (const item of orderedItems) {
        if (!placed.has(item.placeId)) {
          const inserted = await client.query(
            `INSERT INTO library.collection_places (
               collection_id, canonical_place_id, position, added_at
             ) VALUES ($1::uuid,$2::uuid,$3,$4::timestamptz)
             ON CONFLICT (collection_id, canonical_place_id) DO NOTHING`,
            [input.target.collectionId, item.placeId, nextPosition, context.occurredAt],
          )
          if ((inserted.rowCount ?? 0) > 0) {
            membershipChanged = true
            nextPosition += 1
          }
          placed.add(item.placeId)
        }
        await client.query(
          `INSERT INTO library.collection_place_import_provenance (
             collection_id, canonical_place_id, provider_key, source_connection_reference,
             source_list_id, source_item_id, provider_place_id, first_imported_at, last_imported_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8::timestamptz,$8::timestamptz)
           ON CONFLICT (provider_key, source_connection_reference, source_list_id, source_item_id)
           DO UPDATE SET collection_id = EXCLUDED.collection_id,
                         canonical_place_id = EXCLUDED.canonical_place_id,
                         provider_place_id = EXCLUDED.provider_place_id,
                         last_imported_at = EXCLUDED.last_imported_at`,
          [input.target.collectionId, item.placeId, input.source.providerKey,
            input.source.connectionId, input.source.sourceListId, item.sourceItemId,
            item.providerPlaceId, context.occurredAt],
        )
      }

      const persistedBinding = await client.query<{ binding_revision: string }>(
        `INSERT INTO library.import_source_list_bindings (
           provider_key, source_connection_reference, source_list_id, owner_membership_id,
           collection_id, source_name_snapshot, source_position, binding_revision,
           first_bound_at, last_materialized_at
         ) VALUES ($1,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,1,$8::timestamptz,$8::timestamptz)
         ON CONFLICT (provider_key, source_connection_reference, source_list_id)
         DO UPDATE SET source_name_snapshot = EXCLUDED.source_name_snapshot,
                       source_position = EXCLUDED.source_position,
                       binding_revision = library.import_source_list_bindings.binding_revision + 1,
                       last_materialized_at = EXCLUDED.last_materialized_at
         RETURNING binding_revision::text`,
        [input.source.providerKey, input.source.connectionId, input.source.sourceListId,
          context.memberId, input.target.collectionId, input.source.observedName,
          input.source.sourcePosition, context.occurredAt],
      )

      if (!created && membershipChanged) {
        collectionRevision = (await client.query<{ revision: string }>(
          `UPDATE library.collections
           SET revision = revision + 1,
               updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
           WHERE id = $1::uuid RETURNING revision::text`,
          [input.target.collectionId, context.occurredAt],
        )).rows[0]!.revision
      }
      const membershipCount = Number((await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM library.collection_places
         WHERE collection_id = $1::uuid`,
        [input.target.collectionId],
      )).rows[0]!.count)
      const value: ImportedCollectionReceipt = {
        collectionId: input.target.collectionId,
        version: collectionVersion(input.target.collectionId, collectionRevision),
        bindingVersion: bindingVersion({
          providerKey: input.source.providerKey,
          connectionId: input.source.connectionId,
          sourceListId: input.source.sourceListId,
          revision: persistedBinding.rows[0]!.binding_revision,
        }),
        membershipCount,
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

import type { Pool } from 'pg'

import { collectionVersion } from '../../application/collection-version.js'

function importBindingVersion(input: Readonly<{
  providerKey: string; importSourceId: string; sourceListId: string; revision: string
}>): string {
  const payload = Buffer.from(JSON.stringify({ v: 2, ...input }), 'utf8').toString('base64url')
  return `import-binding-revision.v2.${payload}`
}

export type CollectionTransferSnapshot = Readonly<{
  collectionId: string
  collectionVersion: string
  items: readonly Readonly<{ placeId: string; sourcePosition: number }>[]
}>

/** A deliberately narrow export boundary: only canonical Place identity and Collection order. */
export class PostgresCollectionTransferReader {
  constructor(private readonly pool: Pool) {}

  async read(input: Readonly<{ memberId: string; collectionId: string }>) {
    const collection = await this.pool.query<{ revision: string }>(
      `SELECT revision::text FROM library.collections
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [input.collectionId, input.memberId],
    )
    if (collection.rows[0] === undefined) return undefined
    const items = await this.pool.query<{ canonical_place_id: string; position: number }>(
      `SELECT canonical_place_id, position
       FROM library.collection_places
       WHERE collection_id = $1::uuid
       ORDER BY position, canonical_place_id`,
      [input.collectionId],
    )
    return {
      collectionId: input.collectionId,
      collectionVersion: collectionVersion(input.collectionId, collection.rows[0].revision),
      items: items.rows.map((item) => ({
        placeId: item.canonical_place_id,
        sourcePosition: item.position,
      })),
    } satisfies CollectionTransferSnapshot
  }

  async readImportBinding(input: Readonly<{
    memberId: string; providerKey: string; importSourceId: string; sourceListId: string
  }>) {
    const row = (await this.pool.query<{ collection_id: string; binding_revision: string }>(
      `SELECT collection_id, binding_revision::text
       FROM library.import_source_list_bindings
       WHERE owner_membership_id = $1::uuid AND provider_key = $2
         AND import_source_id = $3::uuid AND source_list_id = $4`,
      [input.memberId, input.providerKey, input.importSourceId, input.sourceListId],
    )).rows[0]
    return row === undefined ? undefined : {
      collectionId: row.collection_id,
      bindingVersion: importBindingVersion({
        providerKey: input.providerKey,
        importSourceId: input.importSourceId,
        sourceListId: input.sourceListId,
        revision: row.binding_revision,
      }),
    }
  }
}

import type { Pool } from 'pg'

import type { LibraryQueries } from '../../application/library-queries.js'
import {
  decodePlaceOrganizationCursor,
  encodePlaceOrganizationCursor,
} from '../../application/library-cursor.js'
import {
  InvalidLibraryQueryError,
  type LibraryPlaceOrganizationPage,
} from '../../domain/queries.js'

type PlaceOrganizationRow = Readonly<{
  item_kind: 'collection' | 'tag'
  resource_id: string
  name: string
  sort_name: string
  selected: boolean
  position: number | null
}>

export async function getPostgresLibraryPlaceOrganization(
  pool: Pool,
  input: Parameters<LibraryQueries['getPlaceOrganization']>[0],
): Promise<LibraryPlaceOrganizationPage> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new InvalidLibraryQueryError('Library query limit must be between 1 and 50.')
  }
  const cursor = decodePlaceOrganizationCursor(input.cursor, input.placeId)
  const result = await pool.query<PlaceOrganizationRow>(
    `
      WITH organization_choices AS (
        SELECT
          'collection'::text AS item_kind,
          collection.id AS resource_id,
          collection.name,
          lower(collection.name) AS sort_name,
          (place.canonical_place_id IS NOT NULL) AS selected,
          place.position
        FROM library.collections AS collection
        LEFT JOIN library.collection_places AS place
          ON place.collection_id = collection.id
          AND place.canonical_place_id = $2::uuid
        WHERE collection.owner_membership_id = $1::uuid

        UNION ALL

        SELECT
          'tag'::text AS item_kind,
          tag.id AS resource_id,
          tag.name,
          tag.normalized_name AS sort_name,
          (place.tag_id IS NOT NULL) AS selected,
          NULL::int AS position
        FROM library.tags AS tag
        LEFT JOIN library.place_tags AS place
          ON place.membership_id = $1::uuid
          AND place.canonical_place_id = $2::uuid
          AND place.tag_id = tag.id
        WHERE tag.owner_membership_id = $1::uuid
      )
      SELECT item_kind, resource_id, name, sort_name, selected, position
      FROM organization_choices
      WHERE (
        $3::text IS NULL
        OR (item_kind, sort_name, resource_id) > ($3::text, $4::text, $5::uuid)
      )
      ORDER BY item_kind ASC, sort_name ASC, resource_id ASC
      LIMIT $6
    `,
    [
      input.memberId,
      input.placeId,
      cursor?.itemKind ?? null,
      cursor?.sortName ?? null,
      cursor?.resourceId ?? null,
      input.limit + 1,
    ],
  )
  const hasMore = result.rows.length > input.limit
  const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
  if (rows.some((row) => row.item_kind === 'collection' && row.selected !== (row.position !== null))) {
    throw new InvalidLibraryQueryError('Collection membership selection is invalid.')
  }
  const last = rows.at(-1)
  return {
    schemaVersion: 'library-place-organization.v1',
    placeId: input.placeId,
    items: rows.map((row) => row.item_kind === 'collection'
      ? {
          kind: 'collection',
          collectionId: row.resource_id,
          name: row.name,
          selected: row.selected,
          position: row.position,
        }
      : {
          kind: 'tag',
          tagId: row.resource_id,
          name: row.name,
          selected: row.selected,
        }),
    ...(hasMore && last !== undefined ? {
      nextCursor: encodePlaceOrganizationCursor(input.placeId, {
        itemKind: last.item_kind,
        sortName: last.sort_name,
        resourceId: last.resource_id,
      }),
    } : {}),
  }
}

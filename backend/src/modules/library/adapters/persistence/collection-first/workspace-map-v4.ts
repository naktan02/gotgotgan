import type { Pool } from 'pg'

import { createLibraryMapV4Accumulator } from '../../../application/library-map-v4-features.js'
import { libraryFacetFilterScanLimit } from '../../../application/library-place-facets.js'
import type {
  LibraryPlaceSummaryReader,
  MemberLibraryPlaceSummaryReader,
} from '../../../application/ports/library-place-summary-reader.js'
import type {
  PersonalLibraryMapCollectionV4,
  PersonalLibraryMapPlaceFeatureV4,
  PersonalLibraryMapQueryV4,
  PersonalLibraryMapViewV4,
} from '../../../application/ports/personal-library-map-v4.js'
import { InvalidLibraryQueryError, isValidLibraryMapViewport } from '../../../domain/queries.js'
import type { MapTaxonomyReader } from '../../../../../platform/map-projection/map-classification.js'
import { matchesFavorite, summariesById, type FavoriteRow } from './favorite-read.js'

const maximumSelectedCollections = 100

type CollectionRow = Readonly<{
  id: string
  name: string
  color_token: PersonalLibraryMapCollectionV4['colorToken']
}>

type PlaceMembershipRow = FavoriteRow & Readonly<{
  collection_ids: string[]
}>

function validateSelection(query: PersonalLibraryMapQueryV4): void {
  if (!isValidLibraryMapViewport(query.bounds, query.zoom)) {
    throw new InvalidLibraryQueryError('Library map viewport is invalid.')
  }
  if (query.selection.kind === 'collections' && (
    query.selection.collectionIds.length < 1 ||
    query.selection.collectionIds.length > maximumSelectedCollections ||
    new Set(query.selection.collectionIds).size !== query.selection.collectionIds.length
  )) {
    throw new InvalidLibraryQueryError('Library map Collection selection is invalid.')
  }
}

async function readSelectedCollections(
  pool: Pool,
  query: PersonalLibraryMapQueryV4,
): Promise<readonly PersonalLibraryMapCollectionV4[] | undefined> {
  const ids = query.selection.kind === 'collections' ? query.selection.collectionIds : null
  const result = await pool.query<CollectionRow>(
    `SELECT id, name, color_token
     FROM library.collections
     WHERE owner_membership_id = $1::uuid
       AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
     ORDER BY CASE WHEN $2::uuid[] IS NULL THEN NULL ELSE array_position($2::uuid[], id) END,
              updated_at DESC, id ASC
     LIMIT $3`,
    [query.memberId, ids, maximumSelectedCollections + 1],
  )
  if (query.selection.kind === 'collections' && result.rows.length !== ids?.length) return undefined
  if (result.rows.length > maximumSelectedCollections) {
    throw new InvalidLibraryQueryError('Library map supports at most 100 selected Collections.')
  }
  return result.rows.map((row) => ({
    collectionId: row.id,
    name: row.name,
    colorToken: row.color_token,
  }))
}

async function taxonomyRoots(read?: MapTaxonomyReader) {
  if (read === undefined) return new Map<string, Readonly<{ key: string; label: string }> | null>()
  const nodes = new Map((await read()).map((node) => [node.key, node]))
  const roots = new Map<string, Readonly<{ key: string; label: string }> | null>()
  for (const key of nodes.keys()) {
    let node = nodes.get(key)
    const visited = new Set<string>()
    while (node !== undefined && node.parentKey !== null && !visited.has(node.key)) {
      visited.add(node.key)
      node = nodes.get(node.parentKey)
    }
    roots.set(key, node?.parentKey === null ? { key: node.key, label: node.label } : null)
  }
  return roots
}

export async function readWorkspaceMapV4(
  pool: Pool,
  read: LibraryPlaceSummaryReader,
  readMember: MemberLibraryPlaceSummaryReader | undefined,
  query: PersonalLibraryMapQueryV4,
  signal?: AbortSignal,
  readTaxonomy?: MapTaxonomyReader,
): Promise<PersonalLibraryMapViewV4 | undefined> {
  signal?.throwIfAborted()
  validateSelection(query)
  const selectedCollections = await readSelectedCollections(pool, query)
  if (selectedCollections === undefined) return undefined
  const selectedIds = selectedCollections.map((collection) => collection.collectionId)
  const selectedById = new Map(selectedCollections.map((collection) => [collection.collectionId, collection]))
  const roots = await taxonomyRoots(readTaxonomy)
  const accumulator = createLibraryMapV4Accumulator({ ...query, maxFeatures: 500 })
  let afterPlaceId: string | undefined
  let unprojectedPlaceCount = 0

  while (selectedIds.length > 0) {
    signal?.throwIfAborted()
    const result = await pool.query<PlaceMembershipRow>(
      `WITH candidates AS (
         SELECT placed.canonical_place_id,
                min(placed.position)::int AS source_position,
                array_agg(placed.collection_id::text ORDER BY array_position($2::uuid[], placed.collection_id)) AS collection_ids
         FROM library.collection_places AS placed
         JOIN library.collections AS collection ON collection.id = placed.collection_id
         WHERE collection.owner_membership_id = $1::uuid
           AND placed.collection_id = ANY($2::uuid[])
           AND ($3::uuid IS NULL OR placed.canonical_place_id > $3::uuid)
         GROUP BY placed.canonical_place_id
       )
       SELECT candidate.canonical_place_id, candidate.source_position, candidate.collection_ids,
              cardinality(candidate.collection_ids)::int AS collection_count,
              coalesce(array_agg(DISTINCT tagged.tag_id)
                FILTER (WHERE tagged.tag_id IS NOT NULL), ARRAY[]::uuid[])::text[] AS tag_ids,
              coalesce(array_agg(DISTINCT tag.name)
                FILTER (WHERE tag.name IS NOT NULL), ARRAY[]::text[]) AS tag_names,
              preference.personal_rating
       FROM candidates AS candidate
       LEFT JOIN library.place_preferences AS preference
         ON preference.membership_id = $1::uuid AND preference.canonical_place_id = candidate.canonical_place_id
       LEFT JOIN library.place_tags AS tagged
         ON tagged.membership_id = $1::uuid AND tagged.canonical_place_id = candidate.canonical_place_id
       LEFT JOIN library.tags AS tag ON tag.id = tagged.tag_id AND tag.owner_membership_id = $1::uuid
       WHERE ($4::text = 'any'
           OR ($4::text = 'rated' AND preference.personal_rating IS NOT NULL)
           OR ($4::text = 'unrated' AND preference.personal_rating IS NULL))
       GROUP BY candidate.canonical_place_id, candidate.source_position,
                candidate.collection_ids, preference.personal_rating
       HAVING cardinality($5::uuid[]) = 0
          OR ($6::text = 'any' AND count(DISTINCT tagged.tag_id)
              FILTER (WHERE tagged.tag_id = ANY($5::uuid[])) > 0)
          OR ($6::text = 'all' AND count(DISTINCT tagged.tag_id)
              FILTER (WHERE tagged.tag_id = ANY($5::uuid[])) = cardinality($5::uuid[]))
       ORDER BY candidate.canonical_place_id ASC
       LIMIT $7`,
      [query.memberId, selectedIds, afterPlaceId ?? null, query.ratingFilter.kind,
        query.tagIds, query.tagMatch, libraryFacetFilterScanLimit],
    )
    const summaries = await summariesById(
      read,
      result.rows.map((row) => row.canonical_place_id),
      query.memberId,
      readMember,
    )
    signal?.throwIfAborted()
    for (const row of result.rows) {
      const summary = summaries.get(row.canonical_place_id)?.summary
      if (summary === undefined || summary.location === null) {
        unprojectedPlaceCount += 1
        continue
      }
      if (!matchesFavorite(row, summaries.get(row.canonical_place_id), query)) continue
      const memberships = row.collection_ids.flatMap((collectionId) => {
        const collection = selectedById.get(collectionId)
        return collection === undefined ? [] : [collection]
      })
      if (memberships.length === 0) continue
      accumulator.add({
        kind: 'place',
        placeId: summary.placeId,
        label: summary.name,
        location: summary.location,
        classification: summary.primaryTaxonomy === null ? null : {
          primaryTaxonomy: summary.primaryTaxonomy,
          rootTaxonomy: roots.get(summary.primaryTaxonomy.key) ?? null,
        },
        memberships,
      } satisfies PersonalLibraryMapPlaceFeatureV4)
    }
    if (result.rows.length < libraryFacetFilterScanLimit) break
    afterPlaceId = result.rows.at(-1)?.canonical_place_id
  }

  const features = accumulator.finish()
  return {
    schemaVersion: 'personal-library-map.v4',
    selection: query.selection,
    filter: {
      ...(query.placeQuery === undefined ? {} : { placeQuery: query.placeQuery }),
      ratingFilter: query.ratingFilter,
      tagIds: query.tagIds,
      tagMatch: query.tagMatch,
      areaKeys: query.areaKeys,
      taxonomyKeys: query.taxonomyKeys,
    },
    selectedCollections,
    viewport: { bounds: query.bounds, zoom: query.zoom },
    features,
    coverage: {
      representedPlaceCount: features.reduce(
        (count, feature) => count + (feature.kind === 'place' ? 1 : feature.count),
        0,
      ),
      unprojectedPlaceCount,
      complete: unprojectedPlaceCount === 0,
    },
  }
}

import type { Pool } from 'pg'

import { projectLibraryMapFeatures } from '../../../application/library-map-features.js'
import { matchesLibraryPlaceFacets } from '../../../application/library-place-facets.js'
import type { LibraryQueries } from '../../../application/library-queries.js'
import type { LibraryMapPlaceReader } from '../../../application/ports/library-map-place-reader.js'
import {
  InvalidLibraryQueryError,
  isValidLibraryMapViewport,
  type LibraryMapScope,
} from '../../../domain/queries.js'

type PlaceIdRow = Readonly<{ canonical_place_id: string }>
type CollectionPlacesRow = Readonly<{ place_ids: string[] }>

function normalizedStateScope(scope: Extract<LibraryMapScope, { kind: 'state' }>) {
  if (!['saved', 'wanted', 'rated'].includes(scope.state) || !['all', 'any'].includes(scope.tagMatch)) {
    throw new InvalidLibraryQueryError('Library map state filter is invalid.')
  }
  const tagIds = [...scope.tagIds].sort()
  const areaKeys = [...scope.areaKeys].sort()
  const taxonomyKeys = [...scope.taxonomyKeys].sort()
  if (
    tagIds.length > 20 || new Set(tagIds).size !== tagIds.length ||
    tagIds.some((tagId) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tagId)) ||
    areaKeys.length > 10 || new Set(areaKeys).size !== areaKeys.length ||
    areaKeys.some((key) => !/^area_[A-Za-z0-9_-]{22}$/.test(key)) ||
    taxonomyKeys.length > 10 || new Set(taxonomyKeys).size !== taxonomyKeys.length ||
    taxonomyKeys.some((key) => key.length === 0 || key.length > 128)
  ) throw new InvalidLibraryQueryError('Library map filter is invalid.')
  return { ...scope, tagIds, areaKeys, taxonomyKeys }
}

async function statePlaceIds(
  pool: Pool,
  memberId: string,
  scope: Extract<LibraryMapScope, { kind: 'state' }>,
): Promise<readonly string[]> {
  const preferenceFilter = scope.state === 'saved'
    ? 'saved'
    : scope.state === 'wanted' ? 'wanted' : 'personal_rating IS NOT NULL'
  const result = await pool.query<PlaceIdRow>(
    `SELECT canonical_place_id FROM library.place_preferences
     WHERE membership_id = $1::uuid AND ${preferenceFilter}
       AND (cardinality($2::uuid[]) = 0
         OR ($3::text = 'any' AND EXISTS (
           SELECT 1 FROM library.place_tags AS tagged
           WHERE tagged.membership_id = $1::uuid
             AND tagged.canonical_place_id = library.place_preferences.canonical_place_id
             AND tagged.tag_id = ANY($2::uuid[])))
         OR ($3::text = 'all' AND (
           SELECT count(*) FROM library.place_tags AS tagged
           WHERE tagged.membership_id = $1::uuid
             AND tagged.canonical_place_id = library.place_preferences.canonical_place_id
             AND tagged.tag_id = ANY($2::uuid[])) = cardinality($2::uuid[])))
     ORDER BY canonical_place_id`,
    [memberId, scope.tagIds, scope.tagMatch],
  )
  return result.rows.map((row) => row.canonical_place_id)
}

async function collectionPlaceIds(pool: Pool, memberId: string, collectionId: string) {
  const result = await pool.query<CollectionPlacesRow>(
    `SELECT coalesce(array_agg(place.canonical_place_id ORDER BY place.position, place.canonical_place_id)
       FILTER (WHERE place.canonical_place_id IS NOT NULL), ARRAY[]::uuid[]) AS place_ids
     FROM library.collections AS collection
     LEFT JOIN library.collection_places AS place ON place.collection_id = collection.id
     WHERE collection.id = $1::uuid AND collection.owner_membership_id = $2::uuid
     GROUP BY collection.id`,
    [collectionId, memberId],
  )
  return result.rows[0]?.place_ids
}

export async function getPostgresLibraryMapProjection(
  pool: Pool,
  readMapPlaces: LibraryMapPlaceReader,
  input: Parameters<LibraryQueries['getMapProjection']>[0],
) {
  if (!isValidLibraryMapViewport(input.bounds, input.zoom)) {
    throw new InvalidLibraryQueryError('Library map viewport is invalid.')
  }
  const scope = input.scope.kind === 'state' ? normalizedStateScope(input.scope) : input.scope
  const placeIds = scope.kind === 'state'
    ? await statePlaceIds(pool, input.memberId, scope)
    : await collectionPlaceIds(pool, input.memberId, scope.collectionId)
  if (placeIds === undefined) return undefined
  const uniquePlaceIds = [...new Set(placeIds)]
  const read = await readMapPlaces({ placeIds: uniquePlaceIds, bounds: input.bounds })
  const requested = new Set(uniquePlaceIds)
  const places = read.places.filter((place) => requested.has(place.placeId) && (
    scope.kind === 'collection' || matchesLibraryPlaceFacets(place, scope)
  ))
  const features = projectLibraryMapFeatures({ places, bounds: input.bounds, zoom: input.zoom })
  const representedPlaceCount = features.reduce((count, feature) => (
    count + (feature.kind === 'place' ? 1 : feature.count)
  ), 0)
  return {
    schemaVersion: 'library-map-projection.v1' as const,
    scope,
    viewport: { bounds: input.bounds, zoom: input.zoom },
    features,
    coverage: {
      representedPlaceCount,
      unprojectedPlaceCount: read.unprojectedPlaceCount,
      complete: read.unprojectedPlaceCount === 0,
    },
  }
}

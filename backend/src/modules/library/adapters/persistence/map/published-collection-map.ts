import type { Pool } from 'pg'

import { projectLibraryMapFeatures } from '../../../application/library-map-features.js'
import type { LibraryQueries } from '../../../application/library-queries.js'
import type { LibraryMapPlaceReader } from '../../../application/ports/library-map-place-reader.js'
import { InvalidLibraryQueryError, isValidLibraryMapViewport } from '../../../domain/queries.js'

type PublishedCollectionMapRow = Readonly<{
  id: string
  name: string
  description: string | null
  visibility: 'unlisted' | 'public'
  place_count: number
  updated_at: Date
  place_ids: string[]
}>

export async function getPostgresPublishedCollectionMap(
  pool: Pool,
  readMapPlaces: LibraryMapPlaceReader,
  input: Parameters<LibraryQueries['getPublishedCollectionMap']>[0],
) {
  if (!isValidLibraryMapViewport(input.bounds, input.zoom)) {
    throw new InvalidLibraryQueryError('Published Collection map viewport is invalid.')
  }
  const result = await pool.query<PublishedCollectionMapRow>(
    `SELECT collection.id, collection.name, collection.description, collection.visibility,
            count(place.canonical_place_id)::int AS place_count, collection.updated_at,
            coalesce(array_agg(place.canonical_place_id ORDER BY place.position, place.canonical_place_id)
              FILTER (WHERE place.canonical_place_id IS NOT NULL), ARRAY[]::uuid[]) AS place_ids
     FROM library.collections AS collection
     LEFT JOIN library.collection_places AS place ON place.collection_id = collection.id
     WHERE collection.publication_id = $1::uuid AND collection.visibility IN ('unlisted', 'public')
     GROUP BY collection.id`,
    [input.publicationId],
  )
  const collection = result.rows[0]
  if (collection === undefined) return undefined
  const read = await readMapPlaces({ placeIds: collection.place_ids, bounds: input.bounds })
  const requested = new Set(collection.place_ids)
  const features = projectLibraryMapFeatures({
    places: read.places.filter((place) => requested.has(place.placeId)),
    bounds: input.bounds,
    zoom: input.zoom,
  })
  const representedPlaceCount = features.reduce((count, feature) => (
    count + (feature.kind === 'place' ? 1 : feature.count)
  ), 0)
  return {
    schemaVersion: 'place-published-collection-map.v1' as const,
    publicationId: input.publicationId,
    viewport: { bounds: input.bounds, zoom: input.zoom },
    features,
    coverage: {
      representedPlaceCount,
      unprojectedPlaceCount: read.unprojectedPlaceCount,
      complete: read.unprojectedPlaceCount === 0,
    },
  }
}

import type {
  LibraryMapBounds,
  LibraryMapFeature,
  LibraryPlaceSummary,
} from '../domain/queries.js'

const maximumColumns = 24
type LocatedLibraryPlaceSummary = LibraryPlaceSummary & Readonly<{
  location: NonNullable<LibraryPlaceSummary['location']>
}>

function gridSize(zoom: number): Readonly<{ columns: number; rows: number }> {
  const columns = zoom >= 16 ? maximumColumns : zoom >= 13 ? 18 : zoom >= 10 ? 12 : 8
  return { columns, rows: Math.round(columns * 0.75) }
}

function withinBounds(
  location: NonNullable<LibraryPlaceSummary['location']>,
  bounds: LibraryMapBounds,
): boolean {
  return location.longitude >= bounds.west && location.longitude <= bounds.east &&
    location.latitude >= bounds.south && location.latitude <= bounds.north
}

function clusterBounds(
  places: readonly LocatedLibraryPlaceSummary[],
  viewport: LibraryMapBounds,
  columns: number,
  rows: number,
): LibraryMapBounds {
  const longitudes = places.map((place) => place.location.longitude)
  const latitudes = places.map((place) => place.location.latitude)
  const longitudePadding = Math.max(
    (Math.max(...longitudes) - Math.min(...longitudes)) * 0.15,
    (viewport.east - viewport.west) / columns / 4,
  )
  const latitudePadding = Math.max(
    (Math.max(...latitudes) - Math.min(...latitudes)) * 0.15,
    (viewport.north - viewport.south) / rows / 4,
  )
  return {
    west: Math.max(viewport.west, Math.min(...longitudes) - longitudePadding),
    south: Math.max(viewport.south, Math.min(...latitudes) - latitudePadding),
    east: Math.min(viewport.east, Math.max(...longitudes) + longitudePadding),
    north: Math.min(viewport.north, Math.max(...latitudes) + latitudePadding),
  }
}

export function projectLibraryMapFeatures(input: Readonly<{
  places: readonly LibraryPlaceSummary[]
  bounds: LibraryMapBounds
  zoom: number
}>): readonly LibraryMapFeature[] {
  const uniquePlaces = [...new Map(input.places.map((place) => [place.placeId, place])).values()]
    .filter((place): place is LocatedLibraryPlaceSummary => place.location !== null)
    .filter((place) => withinBounds(place.location, input.bounds))
  const { columns, rows } = gridSize(input.zoom)
  const longitudeSpan = input.bounds.east - input.bounds.west
  const latitudeSpan = input.bounds.north - input.bounds.south
  const cells = new Map<string, {
    column: number
    row: number
    places: LocatedLibraryPlaceSummary[]
  }>()

  for (const place of uniquePlaces) {
    const column = Math.min(columns - 1, Math.floor(
      ((place.location.longitude - input.bounds.west) / longitudeSpan) * columns,
    ))
    const row = Math.min(rows - 1, Math.floor(
      ((input.bounds.north - place.location.latitude) / latitudeSpan) * rows,
    ))
    const key = `${row}:${column}`
    const cell = cells.get(key) ?? { column, row, places: [] }
    cell.places.push(place)
    cells.set(key, cell)
  }

  return [...cells.values()]
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map((cell): LibraryMapFeature => {
      const ordered = cell.places.sort((left, right) => left.placeId.localeCompare(right.placeId))
      const place = ordered[0]
      if (ordered.length === 1 && place !== undefined) {
        return {
          kind: 'place',
          placeId: place.placeId,
          label: place.name,
          location: place.location,
        }
      }
      return {
        kind: 'cluster',
        clusterId: `z${input.zoom}-x${cell.column}-y${cell.row}`,
        count: ordered.length,
        location: {
          latitude: ordered.reduce((sum, item) => sum + item.location.latitude, 0) / ordered.length,
          longitude: ordered.reduce((sum, item) => sum + item.location.longitude, 0) / ordered.length,
        },
        bounds: clusterBounds(ordered, input.bounds, columns, rows),
      }
    })
}

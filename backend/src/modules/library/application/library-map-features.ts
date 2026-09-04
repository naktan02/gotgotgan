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
  const longitudeMatches = bounds.west < bounds.east
    ? location.longitude >= bounds.west && location.longitude <= bounds.east
    : location.longitude >= bounds.west || location.longitude <= bounds.east
  return longitudeMatches && location.latitude >= bounds.south && location.latitude <= bounds.north
}

function longitudeSpan(bounds: LibraryMapBounds): number {
  return bounds.west < bounds.east
    ? bounds.east - bounds.west
    : 360 - bounds.west + bounds.east
}

function unwrapLongitude(longitude: number, bounds: LibraryMapBounds): number {
  return bounds.west > bounds.east && longitude < bounds.west ? longitude + 360 : longitude
}

function normalizeLongitude(longitude: number): number {
  if (longitude > 180) return longitude - 360
  if (longitude < -180) return longitude + 360
  return longitude
}

function clusterBounds(
  viewport: LibraryMapBounds,
  column: number,
  row: number,
  columns: number,
  rows: number,
): LibraryMapBounds {
  const longitudeStep = longitudeSpan(viewport) / columns
  const latitudeStep = (viewport.north - viewport.south) / rows
  return {
    west: column === 0
      ? viewport.west
      : normalizeLongitude(viewport.west + column * longitudeStep),
    south: row === rows - 1
      ? viewport.south
      : viewport.north - (row + 1) * latitudeStep,
    east: column === columns - 1
      ? viewport.east
      : normalizeLongitude(viewport.west + (column + 1) * longitudeStep),
    north: row === 0 ? viewport.north : viewport.north - row * latitudeStep,
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
  const viewportLongitudeSpan = longitudeSpan(input.bounds)
  const latitudeSpan = input.bounds.north - input.bounds.south
  const cells = new Map<string, {
    column: number
    row: number
    places: LocatedLibraryPlaceSummary[]
  }>()

  for (const place of uniquePlaces) {
    const column = Math.min(columns - 1, Math.floor(
      ((unwrapLongitude(place.location.longitude, input.bounds) - input.bounds.west) /
        viewportLongitudeSpan) * columns,
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
        clusterId: `z${Math.floor(input.zoom)}-x${cell.column}-y${cell.row}`,
        count: ordered.length,
        location: {
          latitude: ordered.reduce((sum, item) => sum + item.location.latitude, 0) / ordered.length,
          longitude: normalizeLongitude(ordered.reduce((sum, item) => (
            sum + unwrapLongitude(item.location.longitude, input.bounds)
          ), 0) / ordered.length),
        },
        bounds: clusterBounds(input.bounds, cell.column, cell.row, columns, rows),
      }
    })
}

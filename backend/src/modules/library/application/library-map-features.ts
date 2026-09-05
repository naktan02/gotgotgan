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

/** Consumes unique Place IDs in bounded batches; retains only one accumulator per grid cell. */
export function createLibraryMapAccumulator(input: Readonly<{ bounds: LibraryMapBounds; zoom: number }>) {
  const { columns, rows } = gridSize(input.zoom)
  const longitudeWidth = longitudeSpan(input.bounds)
  const latitudeSpan = input.bounds.north - input.bounds.south
  const cells = new Map<string, {
    column: number; row: number; count: number
    latitudeSum: number; longitudeSum: number
    first: LocatedLibraryPlaceSummary
  }>()
  return {
    add(place: LibraryPlaceSummary): void {
      if (place.location === null || !withinBounds(place.location, input.bounds)) return
      const located = place as LocatedLibraryPlaceSummary
      const longitude = unwrapLongitude(place.location.longitude, input.bounds)
      const column = Math.min(columns - 1, Math.floor(((longitude - input.bounds.west) / longitudeWidth) * columns))
      const row = Math.min(rows - 1, Math.floor(((input.bounds.north - place.location.latitude) / latitudeSpan) * rows))
      const key = `${row}:${column}`
      const current = cells.get(key)
      if (current === undefined) {
        cells.set(key, { column, row, count: 1, latitudeSum: place.location.latitude,
          longitudeSum: longitude, first: located })
      } else {
        current.count += 1
        current.latitudeSum += place.location.latitude
        current.longitudeSum += longitude
        if (place.placeId.localeCompare(current.first.placeId) < 0) current.first = located
      }
    },
    finish(): readonly LibraryMapFeature[] {
      return [...cells.values()]
        .sort((left, right) => left.row - right.row || left.column - right.column)
        .map((cell): LibraryMapFeature => cell.count === 1 ? {
          kind: 'place', placeId: cell.first.placeId, label: cell.first.name, location: cell.first.location,
        } : {
          kind: 'cluster', clusterId: `z${Math.floor(input.zoom)}-x${cell.column}-y${cell.row}`,
          count: cell.count,
          location: { latitude: cell.latitudeSum / cell.count,
            longitude: normalizeLongitude(cell.longitudeSum / cell.count) },
          bounds: clusterBounds(input.bounds, cell.column, cell.row, columns, rows),
        })
    },
  }
}

export function projectLibraryMapFeatures(input: Readonly<{
  places: readonly LibraryPlaceSummary[]
  bounds: LibraryMapBounds
  zoom: number
}>): readonly LibraryMapFeature[] {
  const accumulator = createLibraryMapAccumulator(input)
  for (const place of new Map(input.places.map((place) => [place.placeId, place])).values()) {
    accumulator.add(place)
  }
  return accumulator.finish()
}

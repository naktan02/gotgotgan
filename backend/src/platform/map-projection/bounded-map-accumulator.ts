import {
  mapCoincidentPreviewLimit, mapPixelPosition, mapWorldPixels, minimumMapCellPixels,
  normalizeMapLongitude, unwrapMapLongitude, withinMapBounds,
  type MapBounds, type MapFeature, type MapPoint,
} from './pixel-projection.js'

type Cell = {
  x: number; y: number; count: number; latitudeSum: number; longitudeSum: number
  west: number; east: number; south: number; north: number; first: MapPoint; preview: MapPoint[]
}

/** Unique IDs arrive in bounded batches. Only occupied cells and a bounded coordinate preview survive. */
export function createBoundedMapAccumulator(input: Readonly<{
  bounds: MapBounds; zoom: number; maxFeatures: number; selectedPlaceId?: string | undefined
}>) {
  const worldPixels = mapWorldPixels(input.zoom)
  const selectedPlaceId = input.maxFeatures === 1 ? undefined : input.selectedPlaceId
  const budget = input.maxFeatures - (selectedPlaceId === undefined ? 0 : 1)
  let cellPixels = minimumMapCellPixels
  let cells = new Map<string, Cell>()
  let selected: MapPoint | undefined
  function merge(target: Map<string, Cell>, cell: Cell): void {
    const key = `${Math.floor(cell.x / cellPixels)}:${Math.floor(cell.y / cellPixels)}`
    const prior = target.get(key)
    if (prior === undefined) { target.set(key, cell); return }
    prior.count += cell.count
    prior.latitudeSum += cell.latitudeSum
    prior.longitudeSum += cell.longitudeSum
    prior.west = Math.min(prior.west, cell.west)
    prior.east = Math.max(prior.east, cell.east)
    prior.south = Math.min(prior.south, cell.south)
    prior.north = Math.max(prior.north, cell.north)
    if (cell.first.placeId < prior.first.placeId) prior.first = cell.first
    prior.preview = prior.west === prior.east && prior.south === prior.north
      ? [...prior.preview, ...cell.preview].sort((a, b) => a.placeId.localeCompare(b.placeId)).slice(0, mapCoincidentPreviewLimit)
      : []
  }
  return {
    add(point: MapPoint): void {
      if (!withinMapBounds(point.location, input.bounds)) return
      if (point.placeId === selectedPlaceId) { selected = point; return }
      const { x, y } = mapPixelPosition(point.location, input.bounds, worldPixels)
      const longitude = unwrapMapLongitude(point.location.longitude, input.bounds)
      merge(cells, { x, y, count: 1, latitudeSum: point.location.latitude, longitudeSum: longitude,
        west: longitude, east: longitude, south: point.location.latitude, north: point.location.latitude,
        first: point, preview: [point] })
      while (cells.size > Math.max(1, budget)) {
        cellPixels *= 2
        const coarsened = new Map<string, Cell>()
        for (const cell of cells.values()) merge(coarsened, cell)
        cells = coarsened
      }
    },
    finish(): readonly MapFeature[] {
      const features = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, cell]): MapFeature => {
        if (cell.count === 1) return cell.first
        const coincident = cell.west === cell.east && cell.south === cell.north
        const padding = 0.00001
        return {
          kind: 'cluster', clusterId: `p${cellPixels}-z${input.zoom}-${key}`, count: cell.count,
          location: coincident ? cell.first.location : {
            latitude: cell.latitudeSum / cell.count, longitude: normalizeMapLongitude(cell.longitudeSum / cell.count),
          },
          bounds: {
            west: normalizeMapLongitude(cell.west - (cell.west === cell.east ? padding : 0)),
            east: normalizeMapLongitude(cell.east + (cell.west === cell.east ? padding : 0)),
            south: Math.max(input.bounds.south, cell.south - (cell.south === cell.north ? padding : 0)),
            north: Math.min(input.bounds.north, cell.north + (cell.south === cell.north ? padding : 0)),
          },
          coincidentPreview: coincident ? { places: cell.preview, remainingCount: cell.count - cell.preview.length } : null,
        }
      })
      return selected === undefined ? features : [selected, ...features]
    },
  }
}

import {
  mapCoincidentPreviewLimit,
  mapPixelPosition,
  mapWorldPixels,
  minimumMapCellPixels,
  normalizeMapLongitude,
  unwrapMapLongitude,
  withinMapBounds,
  type MapBounds,
} from '../../../platform/map-projection/pixel-projection.js'
import type {
  PersonalLibraryMapClusterFeatureV4,
  PersonalLibraryMapFeatureV4,
  PersonalLibraryMapPlaceFeatureV4,
} from './ports/personal-library-map-v4.js'

const maximumClusterSegments = 8

type Cell = {
  x: number
  y: number
  count: number
  latitudeSum: number
  longitudeSum: number
  west: number
  east: number
  south: number
  north: number
  first: PersonalLibraryMapPlaceFeatureV4
  preview: PersonalLibraryMapPlaceFeatureV4[]
  distribution: Map<string, { colorToken: PersonalLibraryMapPlaceFeatureV4['memberships'][number]['colorToken']; placeCount: number }>
}

/** Bounded Library-owned clustering that retains Collection membership without leaking it into map infrastructure. */
export function createLibraryMapV4Accumulator(input: Readonly<{
  bounds: MapBounds
  zoom: number
  maxFeatures: number
  selectedPlaceId?: string | undefined
}>) {
  const worldPixels = mapWorldPixels(input.zoom)
  const selectedPlaceId = input.maxFeatures === 1 ? undefined : input.selectedPlaceId
  const budget = input.maxFeatures - (selectedPlaceId === undefined ? 0 : 1)
  let cellPixels = minimumMapCellPixels
  let cells = new Map<string, Cell>()
  let selected: PersonalLibraryMapPlaceFeatureV4 | undefined

  function merge(target: Map<string, Cell>, cell: Cell): void {
    const key = `${Math.floor(cell.x / cellPixels)}:${Math.floor(cell.y / cellPixels)}`
    const prior = target.get(key)
    if (prior === undefined) {
      target.set(key, cell)
      return
    }
    prior.count += cell.count
    prior.latitudeSum += cell.latitudeSum
    prior.longitudeSum += cell.longitudeSum
    prior.west = Math.min(prior.west, cell.west)
    prior.east = Math.max(prior.east, cell.east)
    prior.south = Math.min(prior.south, cell.south)
    prior.north = Math.max(prior.north, cell.north)
    if (cell.first.placeId < prior.first.placeId) prior.first = cell.first
    prior.preview = prior.west === prior.east && prior.south === prior.north
      ? [...prior.preview, ...cell.preview]
          .sort((a, b) => a.placeId.localeCompare(b.placeId))
          .slice(0, mapCoincidentPreviewLimit)
      : []
    for (const [collectionId, member] of cell.distribution) {
      const current = prior.distribution.get(collectionId)
      prior.distribution.set(collectionId, {
        colorToken: member.colorToken,
        placeCount: (current?.placeCount ?? 0) + member.placeCount,
      })
    }
  }

  return {
    add(point: PersonalLibraryMapPlaceFeatureV4): void {
      if (!withinMapBounds(point.location, input.bounds)) return
      if (point.placeId === selectedPlaceId) {
        selected = point
        return
      }
      const { x, y } = mapPixelPosition(point.location, input.bounds, worldPixels)
      const longitude = unwrapMapLongitude(point.location.longitude, input.bounds)
      merge(cells, {
        x,
        y,
        count: 1,
        latitudeSum: point.location.latitude,
        longitudeSum: longitude,
        west: longitude,
        east: longitude,
        south: point.location.latitude,
        north: point.location.latitude,
        first: point,
        preview: [point],
        distribution: new Map(point.memberships.map((membership) => [membership.collectionId, {
          colorToken: membership.colorToken,
          placeCount: 1,
        }])),
      })
      while (cells.size > Math.max(1, budget)) {
        cellPixels *= 2
        const coarsened = new Map<string, Cell>()
        for (const cell of cells.values()) merge(coarsened, cell)
        cells = coarsened
      }
    },

    finish(): readonly PersonalLibraryMapFeatureV4[] {
      const features = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, cell]) => {
        if (cell.count === 1) return cell.first
        const coincident = cell.west === cell.east && cell.south === cell.north
        const distribution = [...cell.distribution.entries()]
          .sort((a, b) => b[1].placeCount - a[1].placeCount || a[0].localeCompare(b[0]))
        const padding = 0.00001
        return {
          kind: 'cluster',
          clusterId: `l${cellPixels}-z${input.zoom}-${key}`,
          count: cell.count,
          location: coincident ? cell.first.location : {
            latitude: cell.latitudeSum / cell.count,
            longitude: normalizeMapLongitude(cell.longitudeSum / cell.count),
          },
          bounds: {
            west: normalizeMapLongitude(cell.west - (cell.west === cell.east ? padding : 0)),
            east: normalizeMapLongitude(cell.east + (cell.west === cell.east ? padding : 0)),
            south: Math.max(input.bounds.south, cell.south - (cell.south === cell.north ? padding : 0)),
            north: Math.min(input.bounds.north, cell.north + (cell.south === cell.north ? padding : 0)),
          },
          coincidentPreview: coincident ? {
            places: cell.preview,
            remainingCount: cell.count - cell.preview.length,
          } : null,
          collectionDistribution: distribution.slice(0, maximumClusterSegments).map(([collectionId, member]) => ({
            collectionId,
            colorToken: member.colorToken,
            placeCount: member.placeCount,
          })),
          remainingCollectionCount: Math.max(0, distribution.length - maximumClusterSegments),
        } satisfies PersonalLibraryMapClusterFeatureV4
      })
      return selected === undefined ? features : [selected, ...features]
    },
  }
}

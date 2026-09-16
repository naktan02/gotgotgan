import type { PlaceMapViewport } from '@/platform/maps/public'

type PublishedMapLocation = Readonly<{ latitude: number; longitude: number }>

const MAX_MERCATOR_LATITUDE = 85.051129

function clampLatitude(value: number): number {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, value))
}

function normalizePositiveLongitude(value: number): number {
  return ((value % 360) + 360) % 360
}

function normalizeLongitude(value: number): number {
  const normalized = normalizePositiveLongitude(value)
  return normalized > 180 ? normalized - 360 : normalized
}

function minimumLongitudeArc(longitudes: readonly number[]) {
  const sorted = longitudes.map(normalizePositiveLongitude).sort((left, right) => left - right)
  if (sorted.length === 1) return { start: sorted[0]!, span: 0 }
  let largestGap = -1
  let gapStartIndex = 0
  sorted.forEach((longitude, index) => {
    const next = index === sorted.length - 1 ? sorted[0]! + 360 : sorted[index + 1]!
    const gap = next - longitude
    if (gap > largestGap) {
      largestGap = gap
      gapStartIndex = index
    }
  })
  const start = sorted[(gapStartIndex + 1) % sorted.length]!
  const end = sorted[gapStartIndex]!
  return { start, span: end < start ? end + 360 - start : end - start }
}

function zoomForSpan(span: number): number {
  return span >= 40 ? 2
    : span >= 10 ? 4
      : span >= 2 ? 6
        : span >= 0.5 ? 8
          : span >= 0.1 ? 10
            : span >= 0.02 ? 12 : 14
}

export function createPublishedMapInitialViewport(
  locations: readonly PublishedMapLocation[],
): PlaceMapViewport {
  if (locations.length === 0) {
    return {
      bounds: {
        west: -180,
        south: -MAX_MERCATOR_LATITUDE,
        east: 180,
        north: MAX_MERCATOR_LATITUDE,
      },
      zoom: 2,
    }
  }
  const longitudeArc = minimumLongitudeArc(locations.map((location) => location.longitude))
  const latitudes = locations.map((location) => clampLatitude(location.latitude))
  const minimumLatitude = Math.min(...latitudes)
  const maximumLatitude = Math.max(...latitudes)
  const longitudePadding = Math.max(longitudeArc.span * 0.15, 0.01)
  const latitudePadding = Math.max((maximumLatitude - minimumLatitude) * 0.15, 0.01)
  const paddedLongitudeSpan = longitudeArc.span + longitudePadding * 2
  const paddedLatitudeSpan = maximumLatitude - minimumLatitude + latitudePadding * 2
  const longitudeBounds = paddedLongitudeSpan >= 360
    ? { west: -180, east: 180 }
    : {
        west: normalizeLongitude(longitudeArc.start - longitudePadding),
        east: normalizeLongitude(longitudeArc.start + longitudeArc.span + longitudePadding),
      }
  return {
    bounds: {
      ...longitudeBounds,
      south: clampLatitude(minimumLatitude - latitudePadding),
      north: clampLatitude(maximumLatitude + latitudePadding),
    },
    zoom: zoomForSpan(Math.max(paddedLongitudeSpan, paddedLatitudeSpan)),
  }
}

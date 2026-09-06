import type { PlaceMapViewport } from '../../../platform/maps/public'

/** Ranking hint only. Never restrict the query to the visible map or request GPS permission. */
export function catalogSearchNear(viewport: PlaceMapViewport) {
  if (viewport.zoom < 5) return undefined
  const { west, east, south, north } = viewport.bounds
  const span = (east - west + 360) % 360
  if (span === 0) return undefined
  return { latitude: (south + north) / 2, longitude: ((west + span / 2 + 540) % 360) - 180 }
}

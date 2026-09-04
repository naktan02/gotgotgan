import type { Map as MapLibreMap } from 'maplibre-gl'

export function configurePlaceMapProjection(map: Pick<MapLibreMap, 'setProjection'>): void {
  map.setProjection({ type: 'globe' })
}

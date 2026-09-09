import type { Map as MapLibreMap } from 'maplibre-gl'

type TransitStyleMap = Pick<MapLibreMap, 'getLayer' | 'setFilter' | 'setLayoutProperty' | 'setPaintProperty'>

const railColors = new Map<string, string>([
  ['tunnel-railway', '#71817b'],
  ['railway-transit', '#68879a'],
  ['railway-transit-hatching', '#536f80'],
  ['railway-service', '#7f8d88'],
  ['railway-service-hatching', '#66756f'],
  ['railway', '#71817b'],
  ['railway-hatching', '#566861'],
  ['bridge-railway', '#71817b'],
  ['bridge-railway-hatching', '#566861'],
])

function ownsOpenMapTilesLayer(
  map: TransitStyleMap,
  layerId: string,
  sourceLayer: 'transportation' | 'poi',
) {
  const layer = map.getLayer(layerId)
  return layer !== undefined && 'source' in layer && layer.source === 'openmaptiles' &&
    'sourceLayer' in layer && layer.sourceLayer === sourceLayer
}

/** Fail-closed readability patch for the known OpenFreeMap Bright/OpenMapTiles layer vocabulary. */
export function configureTransitAppearance(map: TransitStyleMap): void {
  for (const [layerId, color] of railColors) {
    if (ownsOpenMapTilesLayer(map, layerId, 'transportation')) {
      map.setPaintProperty(layerId, 'line-color', color)
    }
  }
  if (!ownsOpenMapTilesLayer(map, 'poi_transit', 'poi')) return
  map.setFilter('poi_transit', [
    'match', ['get', 'class'], ['airport', 'bus', 'rail', 'railway'], true, false,
  ])
  map.setLayoutProperty('poi_transit', 'icon-image', [
    'case', ['==', ['get', 'class'], 'railway'], 'rail', ['to-string', ['get', 'class']],
  ])
  map.setPaintProperty('poi_transit', 'text-color', '#285f72')
}

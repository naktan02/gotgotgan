import type { Map as MapLibreMap } from 'maplibre-gl'

/** Public style API only. Atmosphere must not replace or mute the selected cartographic style. */
export function configureGlobeAppearance(map: Pick<MapLibreMap, 'setSky' | 'setLight'>): void {
  map.setSky({
    'sky-color': '#0b1626', 'horizon-color': '#7896b0', 'sky-horizon-blend': 0.15,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.42, 7, 0],
  })
  map.setLight({ anchor: 'viewport', position: [1.5, 210, 35] })
}

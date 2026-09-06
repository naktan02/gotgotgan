import type { Map as MapLibreMap } from 'maplibre-gl'

/** Public style API only. Globe atmosphere fades before the detailed Bright street map. */
export function configureGlobeAppearance(map: Pick<MapLibreMap, 'getStyle' | 'setPaintProperty' | 'setSky' | 'setLight'>): void {
  map.setSky({
    'sky-color': '#0b1626', 'horizon-color': '#7896b0', 'sky-horizon-blend': 0.15,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.42, 7, 0],
  })
  map.setLight({ anchor: 'viewport', position: [1.5, 210, 35] })
  const style = map.getStyle()
  const source = style.sources.openmaptiles
  // Do not recolor unrelated custom/test styles or erase their expressions.
  if (source?.type !== 'vector' || source.url !== 'https://tiles.openfreemap.org/planet') return
  const colors: Readonly<Record<string, readonly ['background-color' | 'fill-color', string]>> = {
    background: ['background-color', '#b9c3bb'], water: ['fill-color', '#718fa8'],
    'landcover-grass': ['fill-color', '#b1bea7'], 'landcover-grass-park': ['fill-color', '#b1bea7'],
    'landcover-sand': ['fill-color', '#c5c2ad'], 'landcover-wood': ['fill-color', '#9fb197'],
  }
  for (const layer of style.layers) {
    const replacement = colors[layer.id]
    if (replacement === undefined || !('paint' in layer)) continue
    const [property, distantColor] = replacement
    const original = (layer.paint as Record<string, unknown> | undefined)?.[property]
    if (typeof original !== 'string') continue
    map.setPaintProperty(layer.id, property,
      ['interpolate', ['linear'], ['zoom'], 0, distantColor, 5, distantColor, 8, original])
  }
}

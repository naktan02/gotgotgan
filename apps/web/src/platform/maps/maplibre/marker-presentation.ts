import type { PlaceMapMarker } from '../place-map-interface'

export type MapMarkerMode = 'circle' | 'category' | 'detail'
type ScreenPoint = Readonly<{ x: number; y: number }>
const symbols: Readonly<Record<string, Readonly<{ path: string; color: string }>>> = {
  food: { path: 'M5 3v6m3-6v6M3 3v6c0 3 7 3 7 0V3M6.5 12v9M18 3c-4 4-4 10 0 10V3v18', color: '#ce6439' },
  drink: { path: 'M4 5h12v9a5 5 0 0 1-10 0V5m10 1h2a3 3 0 0 1 0 6h-2M3 21h17', color: '#986e45' },
  tourism: { path: 'm3 19 6-14 5 10 3-6 5 10H3m3-7 3 2 3-2', color: '#33816b' },
  shopping: { path: 'M4 8h16l-1 13H5L4 8m4 0V6a4 4 0 0 1 8 0v2', color: '#bd629c' },
  culture: { path: 'm3 8 9-5 9 5H3m3 3v7m6-7v7m6-7v7M3 21h18', color: '#637dc0' },
  lodging: { path: 'M3 19V5m0 8h18v6m-18-2h18M6 8h5v5H6V8m7 0h6v5h-6V8', color: '#886fbd' },
  leisure: { path: 'm8 3 8 18M4 8l16 8M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0', color: '#4b8a9c' },
  services: { path: 'M7 3v4H3v10h4v4h10v-4h4V7h-4V3H7m2 9h6m-3-3v6', color: '#708780' },
  'food.noodle.ramen': { path: 'M3 12h18c-1 7-5 9-9 9s-8-2-9-9M7 4c-3 3 3 3 0 6m5-6c-3 3 3 3 0 6m5-6c-3 3 3 3 0 6', color: '#ce6439' },
  'food.noodle.ramen.shoyu': { path: 'M3 12h18c-1 7-5 9-9 9s-8-2-9-9M6 7h12M8 3v7m8-7v7', color: '#ad7137' },
  'drink.coffee': { path: 'M4 8h12v7a5 5 0 0 1-10 0V8m10 1h2a3 3 0 0 1 0 6h-2M3 22h17M8 2v3m4-3v3', color: '#986e45' },
}

export function markerPresentation(marker: PlaceMapMarker, mode: MapMarkerMode, zoom: number, selected: boolean) {
  const root = marker.classification?.rootTaxonomy?.key
  const primary = marker.classification?.primaryTaxonomy.key
  const symbol = mode === 'detail' && primary !== undefined ? symbols[primary] ?? (root === undefined ? undefined : symbols[root])
    : root === undefined ? undefined : symbols[root]
  return { dot: mode === 'circle' || symbol === undefined || (zoom < 13 && !selected),
    color: symbol?.color ?? '#197968', path: symbol?.path, label: marker.classification?.primaryTaxonomy.label }
}

export function visibleMarkerLabels(markers: readonly PlaceMapMarker[], selected: string | undefined, zoom: number,
  project: (marker: PlaceMapMarker) => Readonly<{ x: number; y: number }>, viewportWidth = Number.POSITIVE_INFINITY): ReadonlySet<string> {
  const occupied: { x: number; y: number; width: number }[] = []
  const visible = new Set<string>()
  for (const marker of [...markers].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || a.id.localeCompare(b.id))) {
    if (zoom < 14 && marker.id !== selected) continue
    const at = project(marker)
    const box = { x: at.x + 14, y: at.y, width: Math.min(160, marker.label.length * 11 + 14) }
    if (box.x + box.width > viewportWidth - 8) box.x = at.x - box.width - 14
    if (marker.id !== selected && occupied.some((other) => Math.abs(other.y - box.y) < 24 &&
        box.x < other.x + other.width + 8 && box.x + box.width + 8 > other.x)) continue
    occupied.push(box)
    visible.add(marker.id)
  }
  return visible
}

/** Keep the badge's click target clear without changing its geographic anchor or clustering data. */
export function clusterBadgeOffset(at: ScreenPoint, obstacles: readonly ScreenPoint[], viewport: Readonly<{ width: number; height: number }>): [number, number] {
  const clear = (offset: readonly number[], obstacle: ScreenPoint) =>
    Math.abs(at.x + offset[0]! - obstacle.x) >= 32 || Math.abs(at.y + offset[1]! - obstacle.y) >= 32
  if (obstacles.every((obstacle) => clear([0, 0], obstacle))) return [0, 0]
  const candidates: [number, number][] = [[0, -38], [0, 38], [-38, 0], [38, 0], [-38, -38], [38, -38], [-38, 38], [38, 38]]
  const inside = candidates.filter(([x, y]) => at.x + x >= 18 && at.x + x <= viewport.width - 18 &&
    at.y + y >= 18 && at.y + y <= viewport.height - 18)
  return inside.find((offset) => obstacles.every((obstacle) => clear(offset, obstacle)))
    ?? inside.find((offset) => obstacles[0] === undefined || clear(offset, obstacles[0])) ?? [0, 0]
}

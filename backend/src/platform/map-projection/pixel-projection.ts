export type MapCoordinate = Readonly<{ latitude: number; longitude: number }>
export type MapBounds = Readonly<{ west: number; east: number; south: number; north: number }>
export type MapTaxonomy = Readonly<{ key: string; label: string }>
export type MapClassification = Readonly<{ primaryTaxonomy: MapTaxonomy; rootTaxonomy: MapTaxonomy | null }> | null
export type MapPoint = Readonly<{ kind: 'place'; placeId: string; label: string; location: MapCoordinate; classification: MapClassification }>
export type MapFeature = MapPoint | Readonly<{
  kind: 'cluster'; clusterId: string; count: number; location: MapCoordinate; bounds: MapBounds
  coincidentPreview: Readonly<{ places: readonly MapPoint[]; remainingCount: number }> | null
}>

export const minimumMapCellPixels = 8
export const mapCoincidentPreviewLimit = 20

export function mapWorldPixels(zoom: number): number { return 512 * 2 ** zoom }
export function unwrapMapLongitude(longitude: number, bounds: MapBounds): number {
  return bounds.west > bounds.east && longitude < bounds.west ? longitude + 360 : longitude
}
export function normalizeMapLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude < -180 ? longitude + 360 : longitude
}
export function withinMapBounds(location: MapCoordinate, bounds: MapBounds): boolean {
  return location.latitude >= bounds.south && location.latitude <= bounds.north &&
    (bounds.west < bounds.east ? location.longitude >= bounds.west && location.longitude <= bounds.east
      : location.longitude >= bounds.west || location.longitude <= bounds.east)
}
export function mapPixelPosition(location: MapCoordinate, bounds: MapBounds, worldPixels: number) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, location.latitude)) * Math.PI / 180
  return {
    x: (unwrapMapLongitude(location.longitude, bounds) + 180) / 360 * worldPixels,
    // Rounded Mercator limits can project a few nanometres outside the world.
    // Negative cells would never join positive cells while coarsening.
    y: Math.max(0, Math.min(worldPixels,
      (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2 * worldPixels)),
  }
}

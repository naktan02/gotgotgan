import { z } from 'zod'

export const uuidSchema = z.string().uuid()

export const maximumWebMercatorLatitude = 85.051129

export const mapLongitudeSchema = z.number().finite().min(-180).max(180)
export const webMercatorLatitudeSchema = z.number().finite()
  .min(-maximumWebMercatorLatitude).max(maximumWebMercatorLatitude)
export const mapZoomSchema = z.number().finite().min(0).max(22)

export const mapQueryViewportFields = {
  west: z.coerce.number().finite().min(-180).max(180),
  south: z.coerce.number().finite()
    .min(-maximumWebMercatorLatitude).max(maximumWebMercatorLatitude),
  east: z.coerce.number().finite().min(-180).max(180),
  north: z.coerce.number().finite()
    .min(-maximumWebMercatorLatitude).max(maximumWebMercatorLatitude),
}
export const mapQueryZoomSchema = z.coerce.number().finite().min(0).max(22)

export function isNonEmptyMapViewport(viewport: Readonly<{
  west: number
  south: number
  east: number
  north: number
}>): boolean {
  return viewport.west !== viewport.east &&
    !(viewport.west === 180 && viewport.east === -180) &&
    viewport.south < viewport.north
}

export const mapViewportSchema = z.object({
  west: mapLongitudeSchema,
  south: webMercatorLatitudeSchema,
  east: mapLongitudeSchema,
  north: webMercatorLatitudeSchema,
}).strict().refine(
  isNonEmptyMapViewport,
  'Map viewport must be non-empty; west greater than east crosses the antimeridian.',
)

export const mapLocationSchema = z.object({
  latitude: webMercatorLatitudeSchema,
  longitude: mapLongitudeSchema,
}).strict()

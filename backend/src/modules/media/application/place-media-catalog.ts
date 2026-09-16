import type { PlaceMediaStore } from './ports/place-media-store.js'
import {
  assertMediaRightsRevision,
  assertPlaceMediaSource,
  mediaSurfaces,
  type MediaRightsRevision,
  type MediaSurface,
  type PlaceMediaSource,
} from '../domain/model.js'

export function createPlaceMediaCatalog(store: PlaceMediaStore) {
  return {
    async recordSource(source: PlaceMediaSource) {
      assertPlaceMediaSource(source)
      return store.recordSource(structuredClone(source))
    },
    async decideRights(rights: MediaRightsRevision) {
      assertMediaRightsRevision(rights)
      return store.decideRights(structuredClone(rights))
    },
    async listDisplayable(input: Readonly<{
      placeId: string
      surface: MediaSurface
      at: string
      limit: number
    }>) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.placeId) ||
        !mediaSurfaces.includes(input.surface) ||
        !Number.isFinite(Date.parse(input.at)) ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 32
      ) throw new Error('Displayable media query is invalid.')
      return store.listDisplayable(input)
    },
  }
}

export type PlaceMediaCatalog = ReturnType<typeof createPlaceMediaCatalog>

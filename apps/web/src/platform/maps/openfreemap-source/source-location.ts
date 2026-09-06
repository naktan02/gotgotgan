import type { RequestTransformFunction } from 'maplibre-gl'

export const OPEN_FREE_MAP_SOURCE_URL = 'https://tiles.openfreemap.org/planet'
export const LOCAL_OPEN_FREE_MAP_SOURCE_PATH = '/api/maps/openfreemap-source'

export const rewriteOpenFreeMapSourceRequest: RequestTransformFunction = (url, resourceType) =>
  resourceType === 'Source' && url === OPEN_FREE_MAP_SOURCE_URL
    ? { url: LOCAL_OPEN_FREE_MAP_SOURCE_PATH, credentials: 'same-origin' }
    : { url }

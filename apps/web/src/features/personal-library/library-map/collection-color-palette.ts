import { collectionColorTokens, type CollectionColorToken } from '@place/contracts/library'
import { mapAccentColor } from '../../../platform/maps/map-accent-palette'

export function collectionColorValue(token: CollectionColorToken): string {
  return mapAccentColor(token)
}

export const collectionColorOptions = collectionColorTokens.map((token) => ({
  token,
  value: mapAccentColor(token),
}))

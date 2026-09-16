import { createHash } from 'node:crypto'

import {
  collectionColorTokens,
  type CollectionColorToken,
} from '../domain/collection-color.js'

export { collectionColorTokens, type CollectionColorToken }

/** A Collection keeps the same provider-neutral palette token on every surface. */
export function collectionColorForId(collectionId: string): CollectionColorToken {
  const index = (createHash('md5').update(collectionId).digest().at(0) ?? 0) % collectionColorTokens.length
  return collectionColorTokens[index] as CollectionColorToken
}

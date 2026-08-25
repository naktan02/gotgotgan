import type { LibraryStore } from './ports/library-store.js'

export function readPublishedCollection(publicationId: string, store: LibraryStore) {
  return store.getPublishedCollection(publicationId)
}

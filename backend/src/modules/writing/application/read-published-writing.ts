import type { WritingStore } from './ports/writing-store.js'

export function readPublishedWriting(publicationId: string, store: WritingStore) {
  return store.getPublished(publicationId)
}

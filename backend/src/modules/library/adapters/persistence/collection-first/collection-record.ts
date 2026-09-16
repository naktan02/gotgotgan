import { collectionVersion } from '../../../application/collection-version.js'
import type { CollectionWorkspaceSummary } from '../../../domain/collection-first.js'

export type CollectionRow = Readonly<{
  id: string
  name: string
  description: string | null
  visibility: 'private' | 'unlisted' | 'public'
  publication_id: string | null
  place_count: number
  revision: string
  updated_at: Date
}>

export function toCollectionWorkspaceSummary(row: CollectionRow): CollectionWorkspaceSummary {
  return {
    collectionId: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    publicationId: row.publication_id,
    placeCount: row.place_count,
    version: collectionVersion(row.id, row.revision),
    updatedAt: row.updated_at.toISOString(),
  }
}

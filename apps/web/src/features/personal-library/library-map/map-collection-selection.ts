import type { PersonalLibraryMapSelectionV4 } from '@place/contracts/library'

export type MapCollectionSelection = PersonalLibraryMapSelectionV4 | Readonly<{ kind: 'none' }>

export function toggleMapCollectionSelection(
  current: MapCollectionSelection,
  collectionId: string,
  availableCollectionIds: readonly string[],
): MapCollectionSelection {
  if (current.kind === 'none') return { kind: 'collections', collectionIds: [collectionId] }
  if (current.kind === 'all') {
    const collectionIds = [...new Set(availableCollectionIds)].filter((candidate) => candidate !== collectionId)
    return collectionIds.length === 0 ? { kind: 'none' } : { kind: 'collections', collectionIds }
  }
  const collectionIds = current.collectionIds.includes(collectionId)
    ? current.collectionIds.filter((candidate) => candidate !== collectionId)
    : [...current.collectionIds, collectionId]
  return collectionIds.length === 0 ? { kind: 'none' } : { kind: 'collections', collectionIds }
}

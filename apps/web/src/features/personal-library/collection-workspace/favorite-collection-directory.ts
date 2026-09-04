import { CollectionLibraryProblem, collectionLibraryHttp } from './collection-library-http'

type CollectionWorkspaceReader = Readonly<{
  workspace: (
    query: Parameters<typeof collectionLibraryHttp.workspace>[0],
    signal: AbortSignal,
  ) => Promise<Readonly<{
    collections: readonly Readonly<{
      collectionId: string
      name: string
      placeCount: number
    }>[]
  }>>
}>

export function createFavoriteCollectionDirectory(
  reader: CollectionWorkspaceReader = collectionLibraryHttp,
) {
  return {
    async readCollections(signal: AbortSignal) {
      try {
        const page = await reader.workspace({
          favoriteScope: { kind: 'all' },
          ratingFilter: { kind: 'any' },
          tagIds: [],
          tagMatch: 'all',
          areaKeys: [],
          taxonomyKeys: [],
          limit: 20,
        }, signal)
        return {
          kind: 'ready' as const,
          items: page.collections.map((item) => ({
            collectionId: item.collectionId,
            name: item.name,
            placeCount: item.placeCount,
          })),
        }
      } catch (error) {
        return error instanceof CollectionLibraryProblem && error.status === 401
          ? { kind: 'signed-out' as const }
          : { kind: 'unavailable' as const }
      }
    },
  }
}

export const favoriteCollectionDirectory = createFavoriteCollectionDirectory()

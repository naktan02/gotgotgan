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
    collectionNextCursor?: string
  }>>
  mapV4: typeof collectionLibraryHttp.mapV4
}>

export function createFavoriteCollectionDirectory(
  reader: CollectionWorkspaceReader = collectionLibraryHttp,
) {
  return {
    async readCollections(signal: AbortSignal) {
      try {
        const items: Array<{ collectionId: string; name: string; placeCount: number }> = []
        let collectionCursor: string | undefined
        do {
          const page = await reader.workspace({
            favoriteScope: { kind: 'all' },
            ratingFilter: { kind: 'any' },
            tagIds: [],
            tagMatch: 'all',
            areaKeys: [],
            taxonomyKeys: [],
            ...(collectionCursor === undefined ? {} : { collectionCursor }),
            limit: 50,
          }, signal)
          items.push(...page.collections)
          collectionCursor = page.collectionNextCursor
        } while (collectionCursor !== undefined && items.length < 100)
        return {
          kind: 'ready' as const,
          items: items.slice(0, 100).map((item) => ({
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
    async readMap(
      query: Parameters<typeof reader.mapV4>[0],
      signal: AbortSignal,
    ) {
      try {
        return { kind: 'ready' as const, projection: await reader.mapV4(query, signal) }
      } catch (error) {
        return error instanceof CollectionLibraryProblem && error.status === 401
          ? { kind: 'signed-out' as const }
          : { kind: 'unavailable' as const }
      }
    },
  }
}

export const favoriteCollectionDirectory = createFavoriteCollectionDirectory()

import type {
  LibraryMapBounds,
  LibraryPlaceSummary,
} from '../../domain/queries.js'

export type LibraryMapPlaceReader = (input: Readonly<{
  placeIds: readonly string[]
  bounds: LibraryMapBounds
}>) => Promise<Readonly<{
  places: readonly LibraryPlaceSummary[]
  unprojectedPlaceCount: number
}>>

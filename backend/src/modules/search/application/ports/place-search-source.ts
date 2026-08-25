import type { PlaceSearchQuery, PlaceSearchResult } from '../../domain/model.js'

export type SearchSourcePage = Readonly<{
  status: 'complete' | 'partial'
  items: readonly PlaceSearchResult[]
  nextCursor?: string
  errorCode?: string
}>

export interface PlaceSearchSource {
  readonly sourceKey: string
  search(query: Omit<PlaceSearchQuery, 'cursor'> & Readonly<{ cursor?: string }>): Promise<SearchSourcePage>
}

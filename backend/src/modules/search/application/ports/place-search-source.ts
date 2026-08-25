import type { PlaceSearchQuery, PlaceSearchResult } from '../../domain/model.js'

export type SearchSourcePage = Readonly<{
  status: 'complete' | 'partial' | 'unavailable'
  items: readonly PlaceSearchResult[]
  nextCursor?: string
  errorCode?: string
}>

export interface PlaceSearchSource {
  readonly sourceKey: string
  accepts?(query: Omit<PlaceSearchQuery, 'cursor'> & Readonly<{ cursor?: string }>): boolean
  search(query: Omit<PlaceSearchQuery, 'cursor'> & Readonly<{ cursor?: string }>): Promise<SearchSourcePage>
}

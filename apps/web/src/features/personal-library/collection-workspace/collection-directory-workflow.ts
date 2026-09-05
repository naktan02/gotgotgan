import type { PersonalLibraryWorkspaceResponseV2 } from '@place/contracts/library'
import { useCallback, useEffect, useRef, useState } from 'react'

import { collectionLibraryHttp } from './collection-library-http'

export function useCollectionDirectory(query: string, revision: number, onFailure: (reason: unknown) => void) {
  const [collections, setCollections] = useState<PersonalLibraryWorkspaceResponseV2['collections']>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>()
  const sequence = useRef(0)
  const controller = useRef<AbortController | undefined>(undefined)
  const read = useCallback(async (cursor?: string) => {
    controller.current?.abort()
    controller.current = new AbortController()
    const request = ++sequence.current
    setError(undefined)
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const page = await collectionLibraryHttp.workspace({
        favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'any' },
        tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 20,
        ...(query.trim() ? { collectionQuery: query.trim() } : {}),
        ...(cursor ? { collectionCursor: cursor } : {}),
      }, controller.current.signal)
      if (sequence.current !== request) return
      setCollections((current) => cursor ? [...current, ...page.collections.filter((item) =>
        !current.some((existing) => existing.collectionId === item.collectionId))] : page.collections)
      setNextCursor(page.collectionNextCursor)
    } catch (reason) {
      if (sequence.current !== request || (reason instanceof DOMException && reason.name === 'AbortError')) return
      setError(reason)
      onFailure(reason)
    } finally {
      if (sequence.current === request) { setLoading(false); setLoadingMore(false) }
    }
  }, [onFailure, query])
  useEffect(() => {
    void read()
    return () => { sequence.current += 1; controller.current?.abort() }
  }, [read, revision])
  return { collections, nextCursor, loading, loadingMore, error, loadMore: () => nextCursor ? read(nextCursor) : undefined }
}

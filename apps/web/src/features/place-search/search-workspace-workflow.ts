'use client'

import {
  placeSearchResponseSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsResponseSchema,
  taxonomyProjectionSchema,
  type PlaceSearchRequest,
  type PlaceSearchResult,
  type PlaceSuggestion,
  type SearchBounds,
  type TaxonomyNode,
} from '@place/contracts/search'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SearchWorkspaceWorkflow } from './search-workspace-interface'

const initialBounds: SearchBounds = {
  west: 126.96, south: 37.48, east: 127.15, north: 37.61,
}

function movedEast(bounds: SearchBounds): SearchBounds {
  const distance = (bounds.east - bounds.west) * 0.8
  return { ...bounds, west: bounds.west + distance, east: bounds.east + distance }
}

async function jsonOrThrow(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error('검색 응답을 사용할 수 없습니다.')
  }
  return response.json()
}

export function usePlaceSearchWorkflow(): SearchWorkspaceWorkflow {
  const [draftQuery, setDraftQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [taxonomyKey, setTaxonomyKey] = useState('')
  const [taxonomy, setTaxonomy] = useState<readonly TaxonomyNode[]>([])
  const [viewportBounds, setViewportBounds] = useState<SearchBounds>(initialBounds)
  const [searchBounds, setSearchBounds] = useState<SearchBounds | undefined>()
  const [items, setItems] = useState<readonly PlaceSearchResult[]>([])
  const [sources, setSources] = useState<readonly { sourceKey: string; status: 'complete' | 'partial' | 'unavailable'; resultCount: number; errorCode?: string }[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [selectedResultId, setSelectedResultId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [mobileSurface, setMobileSurface] = useState<'list' | 'map' | 'detail'>('list')
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestion[]>([])
  const [suggestionSources, setSuggestionSources] = useState<readonly { status: 'complete' | 'partial' | 'unavailable' }[]>([])
  const [suggestionState, setSuggestionState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const requestSequence = useRef(0)
  const suggestionSequence = useRef(0)
  const suggestionSessionId = useRef<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/search/taxonomy', { cache: 'no-store', signal: controller.signal })
      .then(jsonOrThrow)
      .then((payload) => setTaxonomy(taxonomyProjectionSchema.parse(payload).nodes))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setTaxonomy([])
      })
    return () => controller.abort()
  }, [])

  const baseRequest = useMemo<PlaceSearchRequest>(() => ({
    schemaVersion: 'place-search.v1',
    query: submittedQuery,
    filters: { taxonomyKeys: taxonomyKey === '' ? [] : [taxonomyKey] },
    limit: 8,
    ...(searchBounds === undefined ? {} : { bounds: searchBounds }),
  }), [searchBounds, submittedQuery, taxonomyKey])

  const executeSearch = useCallback(async (
    request: PlaceSearchRequest,
    append: boolean,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    if (!append) {
      setSources([])
      setNextCursor(undefined)
    }
    try {
      const response = await fetch('/api/search/places', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        cache: 'no-store',
        signal,
      })
      const payload = placeSearchResponseSchema.parse(await jsonOrThrow(response))
      if (sequence !== requestSequence.current) return
      setItems((current) => {
        const available = append ? [...current, ...payload.items] : payload.items
        setSelectedResultId((selectedResult) =>
          selectedResult !== undefined && available.some((item) => item.resultId === selectedResult)
            ? selectedResult
            : available[0]?.resultId,
        )
        return available
      })
      setSources(payload.sources)
      setNextCursor(payload.nextCursor)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      if (sequence === requestSequence.current) {
        if (!append) setItems([])
        setError('검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.')
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void executeSearch(baseRequest, false, controller.signal)
    }, 300)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [baseRequest, executeSearch])

  useEffect(() => {
    const query = draftQuery.normalize('NFKC').replace(/\s+/g, ' ').trim()
    if (query.length === 0 || query === submittedQuery) {
      setSuggestions([])
      setSuggestionSources([])
      setSuggestionOpen(false)
      setSuggestionState('idle')
      return
    }
    const sequence = ++suggestionSequence.current
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setSuggestionState('loading')
      fetch('/api/search/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'place-suggestions.v1',
          query,
          limit: 8,
          bounds: viewportBounds,
          ...(suggestionSessionId.current === undefined
            ? {}
            : { sessionId: suggestionSessionId.current }),
        }),
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(jsonOrThrow)
        .then((payload) => {
          if (sequence !== suggestionSequence.current) return
          const parsed = placeSuggestionsResponseSchema.parse(payload)
          suggestionSessionId.current = parsed.sessionId
          setSuggestions(parsed.items)
          setSuggestionSources(parsed.sources)
          setActiveSuggestionIndex(0)
          setSuggestionOpen(true)
          setSuggestionState('ready')
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          if (sequence === suggestionSequence.current) {
            setSuggestions([])
            setSuggestionSources([])
            setSuggestionOpen(true)
            setSuggestionState('unavailable')
          }
        })
    }, 180)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [draftQuery, submittedQuery, viewportBounds])

  const submitQuery = useCallback((query: string) => {
    const normalized = query.normalize('NFKC').replace(/\s+/g, ' ').trim()
    setDraftQuery(normalized)
    setSubmittedQuery(normalized)
    setSuggestions([])
    setSuggestionOpen(false)
  }, [])

  const chooseSuggestion = useCallback(async (suggestion: PlaceSuggestion) => {
    try {
      const response = await fetch('/api/search/suggestion-selections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'place-suggestion-selection.v1',
          suggestionId: suggestion.suggestionId,
        }),
        cache: 'no-store',
      })
      placeSuggestionSelectionResponseSchema.parse(await jsonOrThrow(response))
      submitQuery(suggestion.name)
    } catch {
      setSuggestionState('unavailable')
    }
  }, [submitQuery])

  const partial = sources.some((source) => source.status !== 'complete')
  const suggestionPartial = suggestionSources.some((source) => source.status !== 'complete')
  const selected = items.find((item) => item.resultId === selectedResultId)

  function changeDraftQuery(value: string) {
    setDraftQuery(value)
    setActiveSuggestionIndex(0)
  }

  function openSuggestions() {
    if (suggestionState === 'ready' || suggestionState === 'unavailable') {
      setSuggestionOpen(true)
    }
  }

  function moveSuggestion(offset: number) {
    if (suggestions.length === 0) return
    setActiveSuggestionIndex((index) => (
      index + offset + suggestions.length
    ) % suggestions.length)
  }

  const showList = () => setMobileSurface('list')
  const showMap = () => setMobileSurface('map')
  const selectResult = (resultId: string) => {
    setSelectedResultId(resultId)
    setMobileSurface('detail')
  }

  return {
    controls: {
      draftQuery,
      taxonomyKey,
      taxonomy,
      suggestions,
      suggestionState,
      suggestionOpen,
      activeSuggestionIndex,
      partial,
      suggestionPartial,
      error,
      searchViewportDisabled: searchBounds !== undefined &&
        JSON.stringify(searchBounds) === JSON.stringify(viewportBounds),
      submitQuery,
      chooseSuggestion,
      changeDraftQuery,
      closeSuggestions: () => setSuggestionOpen(false),
      openSuggestions,
      moveSuggestion,
      selectTaxonomy: setTaxonomyKey,
      searchViewport: () => setSearchBounds(viewportBounds),
      retrySearch: () => executeSearch(baseRequest, false),
    },
    results: {
      items,
      nextCursor,
      selectedResultId,
      loading,
      loadingMore,
      error,
      boundsApplied: searchBounds !== undefined,
      mobileSurface,
      loadMore: () => {
        if (nextCursor !== undefined) {
          void executeSearch({ ...baseRequest, cursor: nextCursor }, true)
        }
      },
      selectResult,
    },
    detail: {
      selected,
      mobileSurface,
      dismissDetail: () => {
        setMobileSurface('list')
        setSelectedResultId(undefined)
      },
      showList,
    },
    map: {
      bounds: viewportBounds,
      markers: items.map((item) => ({
        id: item.resultId,
        label: item.name,
        location: item.location,
      })),
      selectedMarkerId: selectedResultId,
      selectMarker: selectResult,
      panViewport: () => setViewportBounds((current) => movedEast(current)),
    },
    layout: {
      mobileSurface,
      hasSelection: selected !== undefined,
      showList,
      showMap,
    },
  }
}

import { createHash } from 'node:crypto'

import type { PlaceSearchSource } from './ports/place-search-source.js'
import {
  InvalidSearchCursorError,
  type PlaceSearchPage,
  type PlaceSearchQuery,
  type PlaceSearchResult,
} from '../domain/model.js'

type CoordinatorCursor = Readonly<{
  version: 1
  queryFingerprint: string
  sources: Readonly<Record<string, string>>
}>

function queryFingerprint(query: PlaceSearchQuery): string {
  return createHash('sha256').update(JSON.stringify({
    query: query.query,
    bounds: query.bounds,
    filters: query.filters,
    limit: query.limit,
    viewerMemberId: query.viewerMemberId,
  })).digest('hex')
}

function decodeCursor(value: string, fingerprint: string): CoordinatorCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' || parsed === null ||
      !('version' in parsed) || parsed.version !== 1 ||
      !('queryFingerprint' in parsed) || parsed.queryFingerprint !== fingerprint ||
      !('sources' in parsed) || typeof parsed.sources !== 'object' || parsed.sources === null ||
      Array.isArray(parsed.sources) ||
      Object.values(parsed.sources).some((cursor) => typeof cursor !== 'string')
    ) throw new Error('invalid cursor')
    return parsed as CoordinatorCursor
  } catch {
    throw new InvalidSearchCursorError('Search cursor is invalid for this query.')
  }
}

function encodeCursor(cursor: CoordinatorCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function mergeByPlaceId(pages: readonly Readonly<{ items: readonly PlaceSearchResult[] }>[], limit: number) {
  const seen = new Set<string>()
  const merged: PlaceSearchResult[] = []
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.placeId)) continue
      seen.add(item.placeId)
      merged.push(item)
      if (merged.length === limit) return merged
    }
  }
  return merged
}

export function createPlaceSearch(dependencies: Readonly<{
  sources: readonly PlaceSearchSource[]
}>): (query: PlaceSearchQuery) => Promise<PlaceSearchPage> {
  const sourceKeys = dependencies.sources.map((source) => source.sourceKey)
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error('Place search source keys must be unique.')
  }

  return async (query) => {
    const fingerprint = queryFingerprint(query)
    const prior = query.cursor === undefined
      ? { version: 1 as const, queryFingerprint: fingerprint, sources: {} }
      : decodeCursor(query.cursor, fingerprint)

    const settled = await Promise.all(dependencies.sources.map(async (source) => {
      try {
        const sourceCursor = prior.sources[source.sourceKey]
        const page = await source.search({
          ...query,
          ...(sourceCursor === undefined ? {} : { cursor: sourceCursor }),
        })
        return {
          sourceKey: source.sourceKey,
          page,
          outcome: {
            sourceKey: source.sourceKey,
            status: page.status,
            resultCount: page.items.length,
            ...(page.errorCode === undefined ? {} : { errorCode: page.errorCode }),
          },
        } as const
      } catch {
        return {
          sourceKey: source.sourceKey,
          page: { status: 'partial' as const, items: [] } as const,
          outcome: {
            sourceKey: source.sourceKey,
            status: 'unavailable' as const,
            resultCount: 0,
            errorCode: 'PLACE_SEARCH_SOURCE_UNAVAILABLE',
          },
        } as const
      }
    }))

    const nextSources = Object.fromEntries(
      settled.flatMap((result) => !('nextCursor' in result.page) || result.page.nextCursor === undefined
        ? []
        : [[result.sourceKey, result.page.nextCursor]]),
    )
    const nextCursor = Object.keys(nextSources).length === 0
      ? undefined
      : encodeCursor({ version: 1, queryFingerprint: fingerprint, sources: nextSources })

    return {
      schemaVersion: 'place-search.v1',
      items: mergeByPlaceId(settled.map((result) => result.page), query.limit),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      sources: settled.map((result) => result.outcome),
    }
  }
}

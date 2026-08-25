import { createHash } from 'node:crypto'

import type { PlaceSearchSource } from './ports/place-search-source.js'
import {
  InvalidSearchCursorError,
  type PlaceSearchPage,
  type PlaceSearchQuery,
  type PlaceSearchResult,
} from '../domain/model.js'

type SourceCursorState = Readonly<{
  cursor?: string
  exhausted?: true
}>

type CoordinatorCursor = Readonly<{
  version: 2
  queryFingerprint: string
  sources: Readonly<Record<string, SourceCursorState>>
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

function isSourceState(value: unknown): value is SourceCursorState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'cursor' && key !== 'exhausted')) return false
  return (record.cursor === undefined || typeof record.cursor === 'string') &&
    (record.exhausted === undefined || record.exhausted === true) &&
    !(record.cursor !== undefined && record.exhausted === true)
}

function decodeCursor(value: string, fingerprint: string): CoordinatorCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' || parsed === null ||
      !('version' in parsed) || parsed.version !== 2 ||
      !('queryFingerprint' in parsed) || parsed.queryFingerprint !== fingerprint ||
      !('sources' in parsed) || typeof parsed.sources !== 'object' || parsed.sources === null ||
      Array.isArray(parsed.sources) || !Object.values(parsed.sources).every(isSourceState)
    ) throw new Error('invalid cursor')
    return parsed as CoordinatorCursor
  } catch {
    throw new InvalidSearchCursorError('Search cursor is invalid for this query.')
  }
}

function encodeCursor(cursor: CoordinatorCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function mergeRoundRobin(
  pages: readonly Readonly<{ items: readonly PlaceSearchResult[] }>[],
  limit: number,
): readonly PlaceSearchResult[] {
  const seen = new Set<string>()
  const merged: PlaceSearchResult[] = []
  const maximumLength = Math.max(0, ...pages.map((page) => page.items.length))
  for (let itemIndex = 0; itemIndex < maximumLength; itemIndex += 1) {
    for (const page of pages) {
      const item = page.items[itemIndex]
      if (item === undefined || seen.has(item.resultId)) continue
      seen.add(item.resultId)
      merged.push(item)
      if (merged.length === limit) return merged
    }
  }
  return merged
}

function sourceBudgets(sourceCount: number, limit: number): readonly number[] {
  if (sourceCount === 0) return []
  const minimum = Math.floor(limit / sourceCount)
  const remainder = limit % sourceCount
  return Array.from(
    { length: sourceCount },
    (_, index) => minimum + (index < remainder ? 1 : 0),
  )
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
      ? { version: 2 as const, queryFingerprint: fingerprint, sources: {} }
      : decodeCursor(query.cursor, fingerprint)
    if (Object.keys(prior.sources).some((sourceKey) => !sourceKeys.includes(sourceKey))) {
      throw new InvalidSearchCursorError('Search cursor contains an unknown source.')
    }

    const eligibleSources = dependencies.sources.filter(
      (source) => source.accepts?.(query) ?? true,
    )
    const activeSources = eligibleSources.filter(
      (source) => prior.sources[source.sourceKey]?.exhausted !== true,
    )
    const budgets = sourceBudgets(activeSources.length, query.limit)
    const calledSources = activeSources.flatMap((source, index) => {
      const budget = budgets[index] ?? 0
      return budget === 0 ? [] : [{ source, budget }]
    })

    const settled = await Promise.all(calledSources.map(async ({ source, budget }) => {
      try {
        const sourceCursor = prior.sources[source.sourceKey]?.cursor
        const page = await source.search({
          ...query,
          limit: budget,
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
          page: {
            status: 'unavailable' as const,
            items: [],
            errorCode: 'PLACE_SEARCH_SOURCE_UNAVAILABLE',
          },
          outcome: {
            sourceKey: source.sourceKey,
            status: 'unavailable' as const,
            resultCount: 0,
            errorCode: 'PLACE_SEARCH_SOURCE_UNAVAILABLE',
          },
        } as const
      }
    }))

    const nextStates: Record<string, SourceCursorState> = { ...prior.sources }
    for (const result of settled) {
      nextStates[result.sourceKey] = result.page.nextCursor === undefined
        ? { exhausted: true }
        : { cursor: result.page.nextCursor }
    }
    const hasContinuation = eligibleSources.some(
      (source) => nextStates[source.sourceKey]?.exhausted !== true,
    )
    const nextCursor = hasContinuation
      ? encodeCursor({ version: 2, queryFingerprint: fingerprint, sources: nextStates })
      : undefined

    return {
      schemaVersion: 'place-search.v1',
      items: mergeRoundRobin(settled.map((result) => result.page), query.limit),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      sources: settled.map((result) => result.outcome),
    }
  }
}

import { ConnectorOperationError } from '../../../application/collect-saved-library.js'
import type { AuthenticatedJsonClient } from '../../../application/ports/authenticated-json-client.js'
import type { ProviderSession } from '../../../application/ports/provider-session.js'
import type {
  SavedPlaceCapturePayload,
  SavedPlaceSource,
} from '../../../application/ports/saved-place-source.js'
import { BrowserOriginPermissionDeniedError } from '../../browser/webextensions/provider-page-json-client.js'
import {
  NaverSavedPlaceCollector,
} from './naver-saved-place-collector.js'

const apiBaseUrl = 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/'

function compactText(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join('')
}

function optionalCompactText(value: string | undefined, maximum: number): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  return compactText(value, maximum)
}

function mappedError(error: unknown): ConnectorOperationError {
  if (error instanceof BrowserOriginPermissionDeniedError) {
    return new ConnectorOperationError('permission-denied', false, error.message)
  }
  const message = error instanceof Error ? error.message : ''
  if (message.includes('requires user action')) {
    return new ConnectorOperationError('reauth-required', false, message)
  }
  if (message.includes('temporarily unavailable')) {
    return new ConnectorOperationError('provider-unavailable', true, message)
  }
  if (message.includes('schema changed')) {
    return new ConnectorOperationError('provider-drift', false, message)
  }
  return new ConnectorOperationError('provider-unavailable', true, 'NAVER collection failed.')
}

export class NaverProviderSession implements ProviderSession {
  readonly providerKey = 'naver' as const

  constructor(private readonly client: AuthenticatedJsonClient) {}

  async probe(input: Readonly<{ signal: AbortSignal }>) {
    const url = new URL('folders', apiBaseUrl)
    url.search = new URLSearchParams({
      start: '0', limit: '1', sort: 'lastUseTime', folderType: 'all',
    }).toString()
    try {
      const response = await this.client.get({
        url,
        maximumBytes: 1_048_576,
        signal: input.signal,
      })
      if (new Set([0, 301, 302, 303, 307, 308, 401, 403, 405]).has(response.status)) {
        return 'reauth-required' as const
      }
      if (
        response.status >= 200 && response.status < 300 &&
        response.contentType.toLowerCase().includes('text/html')
      ) return 'reauth-required' as const
      if (
        response.status >= 200 && response.status < 300 &&
        response.contentType.toLowerCase().includes('json')
      ) return 'active' as const
      return 'unavailable' as const
    } catch (error) {
      throw mappedError(error)
    }
  }
}

export class NaverExtensionSavedPlaceSource implements SavedPlaceSource {
  readonly providerKey = 'naver' as const

  constructor(
    private readonly collector: NaverSavedPlaceCollector,
    private readonly client: AuthenticatedJsonClient,
    private readonly maximumBatchItems = 500,
  ) {}

  async *collect(input: Readonly<{ signal: AbortSignal }>): AsyncIterable<SavedPlaceCapturePayload> {
    let collected
    try {
      collected = await this.collector.collectAll({ client: this.client, signal: input.signal })
    } catch (error) {
      throw mappedError(error)
    }
    if (collected.lists.length === 0) {
      yield {
        itemCount: 0,
        payload: JSON.stringify({
          schemaVersion: 'place-naver-saved-capture.v1',
          kind: 'page',
          lists: [],
          nextCursor: null,
        }),
      }
      return
    }
    for (const [listPosition, list] of collected.lists.entries()) {
      const pageCount = Math.max(1, Math.ceil(list.bookmarks.length / this.maximumBatchItems))
      for (let page = 0; page < pageCount; page += 1) {
        const start = page * this.maximumBatchItems
        const bookmarks = list.bookmarks.slice(start, start + this.maximumBatchItems)
        const payload = JSON.stringify({
          schemaVersion: 'place-naver-saved-capture.v1',
          kind: 'page',
          lists: [{
            listId: list.listId,
            name: compactText(list.name, 200),
            position: listPosition,
            bookmarks: bookmarks.map((bookmark, index) => {
              const displayName = optionalCompactText(bookmark.displayName, 300)
              const address = optionalCompactText(bookmark.address, 500)
              const category = optionalCompactText(bookmark.categoryLabel, 300)
              return {
                bookmarkId: bookmark.bookmarkId,
                ...(bookmark.providerPlaceId === undefined
                  ? {}
                  : { placeId: bookmark.providerPlaceId }),
                name: displayName ?? compactText(bookmark.name, 300),
                position: start + index,
                ...(address === undefined ? {} : { address }),
                ...(category === undefined ? {} : { category }),
                ...(bookmark.latitude === undefined || bookmark.longitude === undefined
                  ? {}
                  : { latitude: bookmark.latitude, longitude: bookmark.longitude }),
              }
            }),
          }],
          nextCursor: null,
        })
        yield { itemCount: bookmarks.length, payload }
      }
    }
  }
}

export function createNaverSavedPlaceCollector(): NaverSavedPlaceCollector {
  return new NaverSavedPlaceCollector({
    apiBaseUrl,
    folderPageSize: 20,
    bookmarkPageSize: 100,
    maximumLists: 500,
    maximumBookmarks: 100_000,
    maximumResponseBytes: 4_194_304,
    delayMilliseconds: 150,
  })
}

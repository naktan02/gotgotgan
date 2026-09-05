import { createHash } from 'node:crypto'

import { z } from 'zod'

import {
  NaverSharedLinkTransportError,
  naverSharedLinkResponseError,
  normalizeNaverSharedLinkUrl,
  resolveNaverShareId,
  responseHeader,
  type BoundedHttpResponse,
  type NaverSharedLinkHttpClient,
  type NaverSharedLinkTransportFailureCode,
} from './shared-list-http-policy.js'

export {
  PinnedNaverHttpsClient,
  type BoundedHttpResponse,
  type NaverSharedLinkHttpClient,
} from './shared-list-http-policy.js'

const apiOrigin = 'https://pages.map.naver.com'
const apiPrefix = '/save-pages/api/maps-bookmark/v3/'

const identifierSchema = z.union([
  z.string().min(1).max(512),
  z.number().int().safe(),
]).transform(String)
const optionalTextSchema = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional()

const bookmarkSchema = z.object({
  bookmarkId: identifierSchema,
  sid: identifierSchema.nullable().optional(),
  name: z.string().trim().min(1).max(300),
  displayName: optionalTextSchema(300),
  address: optionalTextSchema(500),
  mcidName: optionalTextSchema(300),
  px: z.number().finite().min(-180).max(180).nullable().optional(),
  py: z.number().finite().min(-90).max(90).nullable().optional(),
}).passthrough()

const sharedBookmarkPageSchema = z.object({
  bookmarkList: z.array(bookmarkSchema).max(500).optional(),
  bookmarks: z.array(bookmarkSchema).max(500).optional(),
  count: z.number().int().nonnegative().safe().optional(),
  totalCount: z.number().int().nonnegative().safe().optional(),
  folder: z.object({
    name: z.string().trim().min(1).max(200),
    shareId: identifierSchema.optional(),
    bookmarkCount: z.number().int().nonnegative().safe().optional(),
  }).passthrough(),
}).passthrough().refine(
  (value) => value.bookmarkList !== undefined || value.bookmarks !== undefined,
  { message: 'A bookmark collection is required.' },
)

export type NaverSharedLinkFailureCode =
  | NaverSharedLinkTransportFailureCode
  | 'source-limit-exceeded'
  | 'provider-parser-drift'

class NaverSharedListError extends Error {
  constructor(
    readonly code: NaverSharedLinkFailureCode,
    readonly retryable: boolean,
  ) {
    super(code)
  }
}

export type NaverSharedList = Readonly<{
  sourceListId: string
  observedName: string
  sourcePosition: number
  items: readonly Readonly<{
    sourceItemId: string
    providerPlaceId: string | null
    observedName: string
    observedAddress: string | null
    observedCategory: string | null
    observedLocation: Readonly<{ latitude: number; longitude: number }> | null
    sourcePosition: number
  }>[]
}>

export type NaverSharedLinkResult =
  | Readonly<{
      entryId: string
      position: number
      status: 'succeeded'
      inputUrlDigest: string
      shareId: string
      list: NaverSharedList
    }>
  | Readonly<{
      entryId: string
      position: number
      status: 'duplicate'
      inputUrlDigest: string
      duplicateOfEntryId: string
    }>
  | Readonly<{
      entryId: string
      position: number
      status: 'failed'
      inputUrlDigest: string
      code: NaverSharedLinkFailureCode
      retryable: boolean
    }>

function urlDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parsePage(response: BoundedHttpResponse) {
  if (response.status < 200 || response.status >= 300) {
    throw naverSharedLinkResponseError(response.status)
  }
  const contentType = responseHeader(response, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) {
    throw new NaverSharedListError('provider-parser-drift', false)
  }
  try {
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body))
    const parsed = sharedBookmarkPageSchema.safeParse(decoded)
    if (!parsed.success) throw new NaverSharedListError('provider-parser-drift', false)
    return parsed.data
  } catch (error) {
    if (error instanceof NaverSharedListError) throw error
    throw new NaverSharedListError('provider-parser-drift', false)
  }
}

export type NaverSharedListSourceOptions = Readonly<{
  pageSize: number
  maximumRedirects: number
  maximumRedirectBytes: number
  maximumResponseBytes: number
  maximumPagesPerList: number
  maximumListItems: number
  maximumItems: number
  maximumNormalizedBytes: number
  maximumLinkDurationMilliseconds: number
  maximumBatchDurationMilliseconds: number
  timeoutMilliseconds: number
}>

const defaultOptions: NaverSharedListSourceOptions = {
  pageSize: 200,
  maximumRedirects: 3,
  maximumRedirectBytes: 32 * 1024,
  maximumResponseBytes: 2 * 1024 * 1024,
  maximumPagesPerList: 10,
  maximumListItems: 500,
  maximumItems: 10_000,
  maximumNormalizedBytes: 8 * 1024 * 1024,
  maximumLinkDurationMilliseconds: 30_000,
  maximumBatchDurationMilliseconds: 120_000,
  timeoutMilliseconds: 8_000,
}

/**
 * NAVER shared-list acquisition Adapter. It accepts only the two reviewed public URL shapes,
 * returns normalized minimum place data, and never treats link access as account ownership.
 */
export class NaverSharedListSource {
  readonly providerKey = 'naver' as const
  readonly method = 'shared-link' as const
  private readonly options: NaverSharedListSourceOptions

  constructor(
    private readonly client: NaverSharedLinkHttpClient,
    options: Partial<NaverSharedListSourceOptions> = {},
  ) {
    this.options = { ...defaultOptions, ...options }
  }

  async inspect(input: Readonly<{
    entries: readonly Readonly<{ entryId: string; position: number; url: string }>[]
    signal: AbortSignal
  }>): Promise<readonly NaverSharedLinkResult[]> {
    if (input.entries.length < 1 || input.entries.length > 20) {
      throw new NaverSharedListError('source-limit-exceeded', false)
    }
    const seenInput = new Map<string, string>()
    const seenShares = new Map<string, string>()
    const results: NaverSharedLinkResult[] = []
    const appendResult = (result: NaverSharedLinkResult) => {
      const jsonbHeadroom = Math.min(
        512 * 1024,
        Math.floor(this.options.maximumNormalizedBytes / 4),
      )
      const limit = result.status === 'succeeded'
        ? this.options.maximumNormalizedBytes - jsonbHeadroom
        : this.options.maximumNormalizedBytes
      if (Buffer.byteLength(JSON.stringify([...results, result]), 'utf8') > limit) {
        throw new NaverSharedListError('source-limit-exceeded', false)
      }
      results.push(result)
    }
    let itemCount = 0
    let providerRateLimited = false
    const batchSignal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.options.maximumBatchDurationMilliseconds),
    ])

    for (const entry of [...input.entries].sort((left, right) => left.position - right.position)) {
      const trimmed = entry.url.trim()
      const digest = urlDigest(trimmed)
      const linkSignal = AbortSignal.any([
        batchSignal,
        AbortSignal.timeout(this.options.maximumLinkDurationMilliseconds),
      ])
      if (providerRateLimited) {
        appendResult({
          entryId: entry.entryId,
          position: entry.position,
          status: 'failed',
          inputUrlDigest: digest,
          code: 'provider-rate-limited',
          retryable: true,
        })
        continue
      }
      try {
        linkSignal.throwIfAborted()
        const url = normalizeNaverSharedLinkUrl(trimmed)
        const normalized = url.toString()
        const duplicateInput = seenInput.get(normalized)
        if (duplicateInput !== undefined) {
          appendResult({
            entryId: entry.entryId,
            position: entry.position,
            status: 'duplicate',
            inputUrlDigest: digest,
            duplicateOfEntryId: duplicateInput,
          })
          continue
        }
        seenInput.set(normalized, entry.entryId)
        const shareId = await resolveNaverShareId(url, this.client, linkSignal, this.options)
        const duplicateShare = seenShares.get(shareId)
        if (duplicateShare !== undefined) {
          appendResult({
            entryId: entry.entryId,
            position: entry.position,
            status: 'duplicate',
            inputUrlDigest: digest,
            duplicateOfEntryId: duplicateShare,
          })
          continue
        }
        seenShares.set(shareId, entry.entryId)
        const bookmarks: Array<z.infer<typeof bookmarkSchema>> = []
        const seenBookmarks = new Set<string>()
        let folderName: string | undefined
        let start = 0
        let pageCount = 0
        while (true) {
          linkSignal.throwIfAborted()
          if (pageCount >= this.options.maximumPagesPerList) {
            throw new NaverSharedListError('source-limit-exceeded', false)
          }
          pageCount += 1
          const url = new URL(`${apiPrefix}shares/${encodeURIComponent(shareId)}/bookmarks`, apiOrigin)
          url.search = new URLSearchParams({
            start: String(start),
            limit: String(this.options.pageSize),
            sort: 'lastUseTime',
          }).toString()
          const page = parsePage(await this.client.get({
            url,
            maximumBytes: this.options.maximumResponseBytes,
            timeoutMilliseconds: this.options.timeoutMilliseconds,
            signal: linkSignal,
          }))
          folderName ??= page.folder.name
          const pageBookmarks = page.bookmarks ?? page.bookmarkList ?? []
          for (const bookmark of pageBookmarks) {
            if (seenBookmarks.has(bookmark.bookmarkId)) continue
            seenBookmarks.add(bookmark.bookmarkId)
            bookmarks.push(bookmark)
            if (bookmarks.length > this.options.maximumListItems) {
              throw new NaverSharedListError('source-limit-exceeded', false)
            }
            if (itemCount + bookmarks.length > this.options.maximumItems) {
              throw new NaverSharedListError('source-limit-exceeded', false)
            }
          }
          start += pageBookmarks.length
          const total = page.totalCount ?? page.count ?? page.folder.bookmarkCount
          if (pageBookmarks.length === 0 || pageBookmarks.length < this.options.pageSize ||
            (total !== undefined && start >= total)) break
        }
        if (folderName === undefined) throw new NaverSharedListError('provider-parser-drift', false)
        appendResult({
          entryId: entry.entryId,
          position: entry.position,
          status: 'succeeded',
          inputUrlDigest: digest,
          shareId,
          list: {
            sourceListId: shareId,
            observedName: folderName,
            sourcePosition: entry.position,
            items: bookmarks.map((bookmark, sourcePosition) => ({
              sourceItemId: bookmark.bookmarkId,
              providerPlaceId: bookmark.sid ?? null,
              observedName: bookmark.displayName || bookmark.name,
              observedAddress: bookmark.address || null,
              observedCategory: bookmark.mcidName || null,
              observedLocation: bookmark.py === undefined || bookmark.py === null ||
                bookmark.px === undefined || bookmark.px === null
                ? null
                : { latitude: bookmark.py, longitude: bookmark.px },
              sourcePosition,
            })),
          },
        })
        itemCount += bookmarks.length
      } catch (error) {
        const failure = error instanceof NaverSharedListError ||
          error instanceof NaverSharedLinkTransportError
          ? error
          : linkSignal.aborted
            ? new NaverSharedListError('request-timeout', true)
            : new NaverSharedListError('provider-unavailable', true)
        if (failure.code === 'provider-rate-limited') providerRateLimited = true
        appendResult({
          entryId: entry.entryId,
          position: entry.position,
          status: 'failed',
          inputUrlDigest: digest,
          code: failure.code,
          retryable: failure.retryable,
        })
      }
    }
    return results
  }
}

import { z } from 'zod'

import type { AuthenticatedJsonClient } from '../../../../application/ports/authenticated-json-client.js'

const identifierSchema = z.union([
  z.string().min(1).max(512),
  z.number().int().safe(),
]).transform(String)
const optionalTextSchema = z.string().max(100_000).nullable().optional()
const optionalTimestampSchema = z.number().int().nonnegative().safe().nullable().optional()

const folderSchema = z.union([
  z.object({ shareId: identifierSchema, name: z.string().min(1).max(1_000) }).passthrough()
    .transform((value) => ({ ...value, listId: value.shareId })),
  z.object({ shareID: identifierSchema, name: z.string().min(1).max(1_000) }).passthrough()
    .transform((value) => ({ ...value, listId: value.shareID })),
])

const folderPageSchema = z.union([
  z.object({
    folders: z.array(folderSchema),
    count: z.number().int().nonnegative().safe().optional(),
    totalCount: z.number().int().nonnegative().safe().optional(),
  }).passthrough().transform((value) => ({
    ...value,
    folderList: value.folders,
    totalCount: value.totalCount ?? value.count,
  })),
  z.object({
    folderList: z.array(folderSchema),
    totalCount: z.number().int().nonnegative().safe().optional(),
  }).passthrough(),
])

export function isNaverSavedFolderResponse(body: Uint8Array): boolean {
  try {
    return folderPageSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))).success
  } catch { return false }
}

const bookmarkSchema = z.object({
  bookmarkId: identifierSchema,
  sid: identifierSchema.nullable().optional(),
  name: z.string().min(1).max(1_000),
  displayName: optionalTextSchema,
  px: z.number().finite().min(-180).max(180).nullable().optional(),
  py: z.number().finite().min(-90).max(90).nullable().optional(),
  type: optionalTextSchema,
  useTime: optionalTimestampSchema,
  lastUpdateTime: optionalTimestampSchema,
  creationTime: optionalTimestampSchema,
  address: optionalTextSchema,
  memo: optionalTextSchema,
  url: optionalTextSchema,
  mcid: optionalTextSchema,
  mcidName: optionalTextSchema,
  rcode: optionalTextSchema,
  cidPath: z.array(identifierSchema).max(200).nullable().optional(),
  available: z.boolean().nullable().optional(),
  isIndoor: z.boolean().nullable().optional(),
}).passthrough()

const bookmarkPageSchema = z.object({
  bookmarkList: z.array(bookmarkSchema).optional(),
  bookmarks: z.array(bookmarkSchema).optional(),
  count: z.number().int().nonnegative().safe().optional(),
  totalCount: z.number().int().nonnegative().safe().optional(),
}).passthrough().refine(
  (value) => value.bookmarkList !== undefined || value.bookmarks !== undefined,
  { message: 'A bookmark collection is required.' },
)

export type NaverCollectedBookmark = Readonly<{
  bookmarkId: string
  providerPlaceId?: string
  name: string
  displayName?: string
  longitude?: number
  latitude?: number
  type?: string
  usedAtEpochMilliseconds?: number
  updatedAtEpochMilliseconds?: number
  createdAtEpochMilliseconds?: number
  address?: string
  memo?: string
  url?: string
  categoryCode?: string
  categoryLabel?: string
  regionCode?: string
  categoryPath?: readonly string[]
  available?: boolean
  indoor?: boolean
}>

export type NaverCollectedList = Readonly<{
  listId: string
  name: string
  bookmarks: readonly NaverCollectedBookmark[]
}>

export type NaverSavedPlaceCollection = Readonly<{
  lists: readonly NaverCollectedList[]
  summary: Readonly<{
    listCount: number
    bookmarkCount: number
    requestCount: number
  }>
}>

type CollectorConfiguration = Readonly<{
  apiBaseUrl: string
  folderPageSize: number
  bookmarkPageSize: number
  maximumLists: number
  maximumBookmarks: number
  maximumResponseBytes: number
  delayMilliseconds: number
}>

function collectionError(message: string): Error {
  return new Error(message)
}

function decodedJson(response: Readonly<{
  status: number
  contentType: string
  body: Uint8Array
}>): unknown {
  if (new Set([301, 302, 303, 307, 308, 401, 403, 405]).has(response.status)) {
    throw collectionError('NAVER saved-place collection requires user action')
  }
  if (response.status === 429) {
    throw collectionError('NAVER saved-place collection is temporarily unavailable')
  }
  if (
    response.status < 200 || response.status >= 300 ||
    !response.contentType.toLowerCase().includes('json')
  ) throw collectionError('NAVER saved-place response schema changed')
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)) as unknown
  } catch {
    throw collectionError('NAVER saved-place response schema changed')
  }
}

function present<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null
}

function collectedBookmark(value: z.infer<typeof bookmarkSchema>): NaverCollectedBookmark {
  return {
    bookmarkId: value.bookmarkId,
    ...(present(value.sid) ? { providerPlaceId: value.sid } : {}),
    name: value.name,
    ...(present(value.displayName) ? { displayName: value.displayName } : {}),
    ...(present(value.px) ? { longitude: value.px } : {}),
    ...(present(value.py) ? { latitude: value.py } : {}),
    ...(present(value.type) ? { type: value.type } : {}),
    ...(present(value.useTime) ? { usedAtEpochMilliseconds: value.useTime } : {}),
    ...(present(value.lastUpdateTime) ? { updatedAtEpochMilliseconds: value.lastUpdateTime } : {}),
    ...(present(value.creationTime) ? { createdAtEpochMilliseconds: value.creationTime } : {}),
    ...(present(value.address) ? { address: value.address } : {}),
    ...(present(value.memo) ? { memo: value.memo } : {}),
    ...(present(value.url) ? { url: value.url } : {}),
    ...(present(value.mcid) ? { categoryCode: value.mcid } : {}),
    ...(present(value.mcidName) ? { categoryLabel: value.mcidName } : {}),
    ...(present(value.rcode) ? { regionCode: value.rcode } : {}),
    ...(present(value.cidPath) ? { categoryPath: value.cidPath } : {}),
    ...(present(value.available) ? { available: value.available } : {}),
    ...(present(value.isIndoor) ? { indoor: value.isIndoor } : {}),
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

export class NaverSavedPlaceCollector {
  private readonly apiBaseUrl: URL

  constructor(private readonly configuration: CollectorConfiguration) {
    this.apiBaseUrl = new URL(configuration.apiBaseUrl)
  }

  async collectAll(input: Readonly<{
    client: AuthenticatedJsonClient
    signal: AbortSignal
  }>): Promise<NaverSavedPlaceCollection> {
    let requestCount = 0
    const request = async (url: URL): Promise<unknown> => {
      if (input.signal.aborted) throw input.signal.reason
      if (requestCount > 0) await wait(this.configuration.delayMilliseconds, input.signal)
      requestCount += 1
      if (requestCount > this.configuration.maximumLists + this.configuration.maximumBookmarks + 2) {
        throw collectionError('NAVER saved-place collection exceeded configured limits')
      }
      return decodedJson(await input.client.get({
        url,
        maximumBytes: this.configuration.maximumResponseBytes,
        signal: input.signal,
      }))
    }

    const folders: Array<{ listId: string; name: string }> = []
    const seenLists = new Set<string>()
    let folderStart = 0
    while (true) {
      const url = new URL('folders', this.apiBaseUrl)
      url.search = new URLSearchParams({
        start: String(folderStart),
        limit: String(this.configuration.folderPageSize),
        sort: 'lastUseTime',
        folderType: 'all',
      }).toString()
      const parsed = folderPageSchema.safeParse(await request(url))
      if (!parsed.success) throw collectionError('NAVER saved-place response schema changed')
      for (const folder of parsed.data.folderList) {
        if (seenLists.has(folder.listId)) continue
        seenLists.add(folder.listId)
        folders.push({ listId: folder.listId, name: folder.name })
        if (folders.length > this.configuration.maximumLists) {
          throw collectionError('NAVER saved-place collection exceeded configured limits')
        }
      }
      folderStart += parsed.data.folderList.length
      if (
        parsed.data.folderList.length === 0 ||
        parsed.data.folderList.length < this.configuration.folderPageSize ||
        (parsed.data.totalCount !== undefined && folderStart >= parsed.data.totalCount)
      ) break
    }

    const lists: NaverCollectedList[] = []
    let bookmarkCount = 0
    for (const folder of folders) {
      const bookmarks: NaverCollectedBookmark[] = []
      const seenBookmarks = new Set<string>()
      let bookmarkStart = 0
      while (true) {
        const url = new URL(
          `shares/${encodeURIComponent(folder.listId)}/bookmarks`,
          this.apiBaseUrl,
        )
        url.search = new URLSearchParams({
          start: String(bookmarkStart),
          limit: String(this.configuration.bookmarkPageSize),
          sort: 'lastUseTime',
        }).toString()
        const parsed = bookmarkPageSchema.safeParse(await request(url))
        if (!parsed.success) throw collectionError('NAVER saved-place response schema changed')
        const pageBookmarks = parsed.data.bookmarks ?? parsed.data.bookmarkList ?? []
        for (const bookmark of pageBookmarks) {
          if (seenBookmarks.has(bookmark.bookmarkId)) continue
          seenBookmarks.add(bookmark.bookmarkId)
          bookmarks.push(collectedBookmark(bookmark))
          bookmarkCount += 1
          if (bookmarkCount > this.configuration.maximumBookmarks) {
            throw collectionError('NAVER saved-place collection exceeded configured limits')
          }
        }
        bookmarkStart += pageBookmarks.length
        const totalCount = parsed.data.totalCount ?? parsed.data.count
        if (
          pageBookmarks.length === 0 ||
          pageBookmarks.length < this.configuration.bookmarkPageSize ||
          (totalCount !== undefined && bookmarkStart >= totalCount)
        ) break
      }
      lists.push({ ...folder, bookmarks })
    }

    return {
      lists,
      summary: { listCount: lists.length, bookmarkCount, requestCount },
    }
  }
}

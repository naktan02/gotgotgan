import { createHash } from 'node:crypto'

import { z } from 'zod'

const providerFailureCodes = {
  login: 'provider-auth-expired',
  mfa: 'provider-mfa-required',
  captcha: 'provider-captcha-required',
  consent: 'provider-consent-required',
  'rate-limit': 'provider-rate-limited',
} as const

const challengeSchema = z.object({
  schemaVersion: z.literal('place-naver-saved-capture.v1'),
  kind: z.literal('challenge'),
  challenge: z.enum(['login', 'mfa', 'captcha', 'consent', 'rate-limit']),
}).strict()

const bookmarkSchema = z.object({
  bookmarkId: z.string().min(1).max(512),
  placeId: z.string().min(1).max(512).optional(),
  position: z.number().int().nonnegative().optional(),
  name: z.string().min(1).max(300),
  address: z.string().min(1).max(500).optional(),
  category: z.string().min(1).max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).strict().refine(
  (value) => (value.latitude === undefined) === (value.longitude === undefined),
  { message: 'Latitude and longitude must be supplied together.' },
)

const pageSchema = z.object({
  schemaVersion: z.literal('place-naver-saved-capture.v1'),
  kind: z.literal('page'),
  lists: z.array(z.object({
    listId: z.string().min(1).max(512),
    name: z.string().min(1).max(200),
    position: z.number().int().nonnegative().optional(),
    bookmarks: z.array(bookmarkSchema).max(500),
  }).strict()).max(100),
  nextCursor: z.string().min(1).max(2048).nullable().optional(),
}).strict()

export type NaverSavedPlaceItem = Readonly<{
  sourceItemKey: string
  sourceListId: string
  sourceListPosition: number
  sourcePosition: number
  providerPlaceId?: string
  listName: string
  name: string
  address: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  reviewReasons: readonly string[]
}>

export type NaverSavedPlaceParseResult =
  | Readonly<{
      kind: 'page'
      items: readonly NaverSavedPlaceItem[]
      nextCursor: string | null
    }>
  | Readonly<{
      kind: 'needs-user-action'
      code: Exclude<(typeof providerFailureCodes)[keyof typeof providerFailureCodes], 'provider-rate-limited'> | 'provider-parser-drift'
    }>
  | Readonly<{ kind: 'failure'; code: 'provider-rate-limited'; retryable: true }>

export function parseNaverSavedPlaceCapture(input: Readonly<{
  body: Uint8Array
  contentType: string
  observedAt: string
}>): NaverSavedPlaceParseResult {
  if (!input.contentType.toLowerCase().includes('json')) {
    return { kind: 'needs-user-action', code: 'provider-parser-drift' }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.body))
  } catch {
    return { kind: 'needs-user-action', code: 'provider-parser-drift' }
  }
  const challenge = challengeSchema.safeParse(decoded)
  if (challenge.success) {
    if (challenge.data.challenge === 'rate-limit') {
      return { kind: 'failure', code: 'provider-rate-limited', retryable: true }
    }
    return { kind: 'needs-user-action', code: providerFailureCodes[challenge.data.challenge] }
  }
  const page = pageSchema.safeParse(decoded)
  if (!page.success) return { kind: 'needs-user-action', code: 'provider-parser-drift' }

  return {
    kind: 'page',
    items: page.data.lists.flatMap((list, sourceListPosition) => list.bookmarks.map((bookmark, sourcePosition) => ({
      sourceItemKey: `${list.listId}:${bookmark.bookmarkId}`,
      sourceListId: list.listId,
      sourceListPosition: list.position ?? sourceListPosition,
      sourcePosition: bookmark.position ?? sourcePosition,
      ...(bookmark.placeId === undefined ? {} : { providerPlaceId: bookmark.placeId }),
      listName: list.name,
      name: bookmark.name,
      address: bookmark.address ?? null,
      categoryLabel: bookmark.category ?? null,
      location: bookmark.latitude === undefined || bookmark.longitude === undefined
        ? null
        : { latitude: bookmark.latitude, longitude: bookmark.longitude },
      reviewReasons: [
        ...(bookmark.placeId === undefined ? ['provider-place-id-missing'] : []),
        ...(bookmark.address === undefined ? ['address-missing'] : []),
        ...(bookmark.latitude === undefined ? ['location-missing'] : []),
      ],
    }))),
    nextCursor: page.data.nextCursor ?? null,
  }
}

export type NaverSavedPlaceCapture = Readonly<{
  body: Uint8Array
  checksum: string
  contentType: 'application/json'
  acquisitionKind: 'structured-web' | 'browser-network' | 'browser-dom'
  observedAt: string
}>

export interface NaverSavedPlaceAcquisition {
  capture(input: Readonly<{
    profileReference: string
    secretReference?: string
    cursor: string | null
    limit: number
    signal: AbortSignal
  }>): Promise<NaverSavedPlaceCapture>
}

export class NaverSavedPlaceSource {
  readonly providerKey = 'naver' as const

  constructor(private readonly acquisition: NaverSavedPlaceAcquisition) {}

  async readPage(input: Readonly<{
    connection: Readonly<{
      connectionId: string
      providerKey: 'naver'
      profileReference?: string
      secretReference?: string
    }>
    cursor: string | null
    limit: number
    signal: AbortSignal
  }>) {
    if (input.connection.profileReference === undefined) {
      return { kind: 'needs-user-action' as const, code: 'provider-auth-expired' as const }
    }
    let capture: NaverSavedPlaceCapture
    try {
      capture = await this.acquisition.capture({
        profileReference: input.connection.profileReference,
        ...(input.connection.secretReference === undefined
          ? {}
          : { secretReference: input.connection.secretReference }),
        cursor: input.cursor,
        limit: input.limit,
        signal: input.signal,
      })
    } catch {
      return { kind: 'failure' as const, code: 'provider-unavailable' as const, retryable: true }
    }
    const checksum = createHash('sha256').update(capture.body).digest('hex')
    if (checksum !== capture.checksum) {
      return { kind: 'failure' as const, code: 'capture-invalid' as const, retryable: false }
    }
    const parsed = parseNaverSavedPlaceCapture(capture)
    if (parsed.kind === 'needs-user-action') return parsed
    return {
      ...parsed,
      capture: { ...capture, parserVersion: 'naver-saved-place.v1' },
    }
  }
}

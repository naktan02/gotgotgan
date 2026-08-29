import { createHash } from 'node:crypto'

import {
  InvalidLibraryCursorError,
  type LibraryPlaceState,
  type LibraryTagMatch,
} from '../domain/queries.js'

type PlaceCursor = Readonly<{ updatedAt: string; placeId: string }>
type CollectionCursor = Readonly<{ updatedAt: string; collectionId: string }>
type CollectionPlaceCursor = Readonly<{ position: number; placeId: string }>
type TagCursor = Readonly<{ normalizedName: string }>
type PlaceOrganizationCursor = Readonly<{
  itemKind: 'collection' | 'tag'
  sortName: string
  resourceId: string
}>
type PublishedCollectionCursor = Readonly<{
  position: number
  placeId: string
}>
type PlaceFilter = Readonly<{
  state: LibraryPlaceState
  tagIds: readonly string[]
  tagMatch: LibraryTagMatch
  areaKeys: readonly string[]
  taxonomyKeys: readonly string[]
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readPayload(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new InvalidLibraryCursorError('Library cursor is invalid.')
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function encode(payload: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function placeFilterFingerprint(filter: PlaceFilter): string {
  return createHash('sha256').update(JSON.stringify(filter)).digest('base64url')
}

export function decodePlaceCursor(
  value: string | undefined,
  filter: PlaceFilter,
): PlaceCursor | undefined {
  const payload = readPayload(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 3 || payload.kind !== 'places' || payload.state !== filter.state ||
    payload.filterFingerprint !== placeFilterFingerprint(filter) ||
    !validTimestamp(payload.updatedAt) || !validUuid(payload.placeId)
  ) throw new InvalidLibraryCursorError('Library place cursor is invalid.')
  return { updatedAt: payload.updatedAt, placeId: payload.placeId }
}

export function encodePlaceCursor(filter: PlaceFilter, cursor: PlaceCursor): string {
  return encode({
    v: 3,
    kind: 'places',
    state: filter.state,
    filterFingerprint: placeFilterFingerprint(filter),
    ...cursor,
  })
}

export function decodeCollectionCursor(value: string | undefined): CollectionCursor | undefined {
  const payload = readPayload(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'collections' ||
    !validTimestamp(payload.updatedAt) || !validUuid(payload.collectionId)
  ) throw new InvalidLibraryCursorError('Library collection cursor is invalid.')
  return { updatedAt: payload.updatedAt, collectionId: payload.collectionId }
}

export function encodeCollectionCursor(cursor: CollectionCursor): string {
  return encode({ v: 1, kind: 'collections', ...cursor })
}

export function decodeCollectionPlaceCursor(
  value: string | undefined,
  collectionId: string,
): CollectionPlaceCursor | undefined {
  const payload = readPayload(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'collection-places' ||
    payload.collectionId !== collectionId ||
    typeof payload.position !== 'number' || !Number.isInteger(payload.position) ||
    payload.position < 0 || !validUuid(payload.placeId)
  ) throw new InvalidLibraryCursorError('Library collection-place cursor is invalid.')
  return { position: payload.position, placeId: payload.placeId }
}

export function encodeCollectionPlaceCursor(
  collectionId: string,
  cursor: CollectionPlaceCursor,
): string {
  return encode({ v: 1, kind: 'collection-places', collectionId, ...cursor })
}

export function decodePublishedCollectionCursor(
  value: string | undefined,
  publicationId: string,
  collectionUpdatedAt: string,
): PublishedCollectionCursor | undefined {
  const payload = readPayload(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'published-collection-places' ||
    payload.publicationId !== publicationId || payload.collectionUpdatedAt !== collectionUpdatedAt ||
    typeof payload.position !== 'number' || !Number.isInteger(payload.position) ||
    payload.position < 0 || !validUuid(payload.placeId)
  ) throw new InvalidLibraryCursorError('Published Collection cursor is invalid.')
  return { position: payload.position, placeId: payload.placeId }
}

export function encodePublishedCollectionCursor(
  publicationId: string,
  collectionUpdatedAt: string,
  cursor: PublishedCollectionCursor,
): string {
  return encode({
    v: 1,
    kind: 'published-collection-places',
    publicationId,
    collectionUpdatedAt,
    ...cursor,
  })
}

export function decodeTagCursor(value: string | undefined): TagCursor | undefined {
  const payload = readPayload(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'tags' ||
    typeof payload.normalizedName !== 'string' || payload.normalizedName.length === 0 ||
    payload.normalizedName.length > 64
  ) throw new InvalidLibraryCursorError('Library tag cursor is invalid.')
  return { normalizedName: payload.normalizedName }
}

export function encodeTagCursor(cursor: TagCursor): string {
  return encode({ v: 1, kind: 'tags', ...cursor })
}

export function decodePlaceOrganizationCursor(
  value: string | undefined,
  placeId: string,
): PlaceOrganizationCursor | undefined {
  const payload = readPayload(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'place-organization' ||
    payload.placeId !== placeId ||
    (payload.itemKind !== 'collection' && payload.itemKind !== 'tag') ||
    typeof payload.sortName !== 'string' || payload.sortName.length === 0 ||
    payload.sortName.length > 120 || !validUuid(payload.resourceId)
  ) throw new InvalidLibraryCursorError('Library Place organization cursor is invalid.')
  return {
    itemKind: payload.itemKind,
    sortName: payload.sortName,
    resourceId: payload.resourceId,
  }
}

export function encodePlaceOrganizationCursor(
  placeId: string,
  cursor: PlaceOrganizationCursor,
): string {
  return encode({ v: 1, kind: 'place-organization', placeId, ...cursor })
}

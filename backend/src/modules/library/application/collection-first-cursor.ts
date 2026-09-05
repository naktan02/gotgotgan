import { createHash } from 'node:crypto'

import type { PersonalLibraryWorkspaceQuery } from '../domain/collection-first.js'
import { InvalidLibraryCursorError } from '../domain/queries.js'

type CollectionCursor = Readonly<{ updatedAt: string; collectionId: string }>
type FavoriteCursor = Readonly<{ placeId: string }>
type FilingCursor = Readonly<{ updatedAt: string; collectionId: string }>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function encode(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decode(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new InvalidLibraryCursorError('Collection-first Library cursor is invalid.')
  }
}

function queryFingerprint(query: PersonalLibraryWorkspaceQuery): string {
  return createHash('sha256').update(JSON.stringify({
    memberId: query.memberId,
    favoriteScope: query.favoriteScope,
    ratingFilter: query.ratingFilter,
    tagIds: [...query.tagIds].sort(),
    tagMatch: query.tagMatch,
    areaKeys: [...query.areaKeys].sort(),
    taxonomyKeys: [...query.taxonomyKeys].sort(),
    ...(query.collectionQuery ? { collectionQuery: query.collectionQuery } : {}),
    ...(query.placeQuery ? { placeQuery: query.placeQuery } : {}),
  })).digest('base64url')
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function encodeWorkspaceCollectionCursor(
  query: PersonalLibraryWorkspaceQuery,
  cursor: CollectionCursor,
): string {
  return encode({ v: 2, kind: 'workspace-collections', query: queryFingerprint(query), ...cursor })
}

export function decodeWorkspaceCollectionCursor(
  value: string | undefined,
  query: PersonalLibraryWorkspaceQuery,
): CollectionCursor | undefined {
  const payload = decode(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 2 || payload.kind !== 'workspace-collections' ||
    payload.query !== queryFingerprint(query) || !validTimestamp(payload.updatedAt) ||
    !validUuid(payload.collectionId)
  ) throw new InvalidLibraryCursorError('Collection workspace cursor is invalid.')
  return { updatedAt: payload.updatedAt, collectionId: payload.collectionId }
}

export function encodeWorkspaceFavoriteCursor(
  query: PersonalLibraryWorkspaceQuery,
  cursor: FavoriteCursor,
): string {
  return encode({ v: 2, kind: 'workspace-favorites', query: queryFingerprint(query), ...cursor })
}

export function decodeWorkspaceFavoriteCursor(
  value: string | undefined,
  query: PersonalLibraryWorkspaceQuery,
): FavoriteCursor | undefined {
  const payload = decode(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 2 || payload.kind !== 'workspace-favorites' ||
    payload.query !== queryFingerprint(query) || !validUuid(payload.placeId)
  ) throw new InvalidLibraryCursorError('Collection favorite cursor is invalid.')
  return { placeId: payload.placeId }
}

function filingFingerprint(memberId: string, placeId: string): string {
  return createHash('sha256').update(`${memberId}\0${placeId}`).digest('base64url')
}

export function encodePlaceFilingCursor(
  memberId: string,
  placeId: string,
  cursor: FilingCursor,
): string {
  return encode({
    v: 2,
    kind: 'place-filing',
    filing: filingFingerprint(memberId, placeId),
    ...cursor,
  })
}

export function decodePlaceFilingCursor(
  value: string | undefined,
  memberId: string,
  placeId: string,
): FilingCursor | undefined {
  const payload = decode(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 2 || payload.kind !== 'place-filing' ||
    payload.filing !== filingFingerprint(memberId, placeId) ||
    !validTimestamp(payload.updatedAt) || !validUuid(payload.collectionId)
  ) throw new InvalidLibraryCursorError('Place filing cursor is invalid.')
  return { updatedAt: payload.updatedAt, collectionId: payload.collectionId }
}

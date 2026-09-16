import { createHash } from 'node:crypto'

import type {
  PublicCollectionDiscoveryQuery,
  PublicCollectionDiscoverySort,
} from '../domain/public-collection-discovery.js'
import { InvalidLibraryCursorError } from '../domain/queries.js'

export type DirectoryAnchor =
  | Readonly<{ sort: 'recent'; updatedAt: string; collectionId: string }>
  | Readonly<{
      sort: 'largest'; placeCount: number; updatedAt: string; collectionId: string
    }>
  | Readonly<{ sort: 'name'; normalizedName: string; collectionId: string }>

export type DetailAnchor = Readonly<{
  position: number
  placeId: string
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(query: Omit<PublicCollectionDiscoveryQuery, 'cursor' | 'limit'>): string {
  return createHash('sha256').update(JSON.stringify(query)).digest('base64url')
}

function read(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new InvalidLibraryCursorError('Public Collection cursor is invalid.')
  }
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function encodePublicCollectionDirectoryCursor(
  query: Omit<PublicCollectionDiscoveryQuery, 'cursor' | 'limit'>,
  anchor: DirectoryAnchor,
): string {
  return encode({ v: 2, kind: 'public-collection-directory', fingerprint: fingerprint(query), ...anchor })
}

export function decodePublicCollectionDirectoryCursor(
  value: string | undefined,
  query: Omit<PublicCollectionDiscoveryQuery, 'cursor' | 'limit'>,
): DirectoryAnchor | undefined {
  if (value === undefined) return undefined
  const payload = read(value)
  const sort = payload.sort as PublicCollectionDiscoverySort
  if (
    payload.v !== 2 || payload.kind !== 'public-collection-directory' ||
    payload.fingerprint !== fingerprint(query) || sort !== query.sort ||
    !validUuid(payload.collectionId)
  ) throw new InvalidLibraryCursorError('Public Collection directory cursor is invalid.')
  if (sort === 'recent' && validTimestamp(payload.updatedAt)) {
    return { sort, updatedAt: payload.updatedAt, collectionId: payload.collectionId }
  }
  if (
    sort === 'largest' && typeof payload.placeCount === 'number' &&
    Number.isInteger(payload.placeCount) && payload.placeCount >= 0 &&
    validTimestamp(payload.updatedAt)
  ) {
    return {
      sort, placeCount: payload.placeCount, updatedAt: payload.updatedAt,
      collectionId: payload.collectionId,
    }
  }
  if (
    sort === 'name' && typeof payload.normalizedName === 'string' &&
    payload.normalizedName.length > 0 && payload.normalizedName.length <= 120
  ) return { sort, normalizedName: payload.normalizedName, collectionId: payload.collectionId }
  throw new InvalidLibraryCursorError('Public Collection directory cursor is invalid.')
}

export function encodeDiscoverableCollectionCursor(
  publicationId: string,
  publicationVersion: string,
  anchor: DetailAnchor,
): string {
  return encode({
    v: 2, kind: 'discoverable-collection-places', publicationId, publicationVersion, ...anchor,
  })
}

export function decodeDiscoverableCollectionCursor(
  value: string | undefined,
  publicationId: string,
  publicationVersion: string,
): DetailAnchor | undefined {
  if (value === undefined) return undefined
  const payload = read(value)
  if (
    payload.v !== 2 || payload.kind !== 'discoverable-collection-places' ||
    payload.publicationId !== publicationId || payload.publicationVersion !== publicationVersion ||
    typeof payload.position !== 'number' || !Number.isInteger(payload.position) ||
    payload.position < 0 || !validUuid(payload.placeId)
  ) throw new InvalidLibraryCursorError('Discoverable Collection cursor is invalid.')
  return { position: payload.position, placeId: payload.placeId }
}

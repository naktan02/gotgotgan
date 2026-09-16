import type { OpaqueVersion } from '../domain/collection-first.js'

const collectionVersionPrefix = 'collection-revision.v1.'

/** Opaque transport version shared by owner and publication projections. */
export function collectionVersion(collectionId: string, revision: string | number): OpaqueVersion {
  const payload = Buffer.from(JSON.stringify({ v: 1, collectionId, revision: String(revision) }), 'utf8')
    .toString('base64url')
  return `${collectionVersionPrefix}${payload}` as OpaqueVersion
}

export function readCollectionRevision(
  value: OpaqueVersion,
  collectionId: string,
): string | undefined {
  const encoded = value.startsWith(collectionVersionPrefix)
    ? value.slice(collectionVersionPrefix.length)
    : undefined
  if (encoded === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (
      parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).v !== 1 ||
      (parsed as Record<string, unknown>).collectionId !== collectionId ||
      !/^\d+$/.test(String((parsed as Record<string, unknown>).revision))
    ) return undefined
    return String((parsed as Record<string, unknown>).revision)
  } catch {
    return undefined
  }
}

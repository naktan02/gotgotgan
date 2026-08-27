import { InvalidWritingCursorError, type WritingKindFilter } from '../domain/queries.js'

type WritingCursor = Readonly<{ updatedAt: string; documentId: string }>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function decodeWritingCursor(
  value: string | undefined,
  kind: WritingKindFilter,
): WritingCursor | undefined {
  if (value === undefined) return undefined
  try {
    const payload: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      !('v' in payload) || payload.v !== 1 ||
      !('kind' in payload) || payload.kind !== 'writing' ||
      !('filter' in payload) || payload.filter !== kind ||
      !('updatedAt' in payload) || typeof payload.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(payload.updatedAt)) ||
      !('documentId' in payload) || typeof payload.documentId !== 'string' ||
      !uuidPattern.test(payload.documentId)
    ) throw new Error()
    return { updatedAt: payload.updatedAt, documentId: payload.documentId }
  } catch {
    throw new InvalidWritingCursorError('Writing cursor is invalid.')
  }
}

export function encodeWritingCursor(
  kind: WritingKindFilter,
  cursor: WritingCursor,
): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    kind: 'writing',
    filter: kind,
    ...cursor,
  }), 'utf8').toString('base64url')
}

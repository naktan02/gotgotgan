import { InvalidVisitCursorError } from '../domain/queries.js'

type VisitCursor = Readonly<{ visitedAt: string; visitId: string }>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function decodeVisitCursor(
  value: string | undefined,
  placeId: string,
): VisitCursor | undefined {
  if (value === undefined) return undefined
  try {
    const payload: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      !('v' in payload) || payload.v !== 1 ||
      !('kind' in payload) || payload.kind !== 'place-visits' ||
      !('placeId' in payload) || payload.placeId !== placeId ||
      !('visitedAt' in payload) || typeof payload.visitedAt !== 'string' ||
      !Number.isFinite(Date.parse(payload.visitedAt)) ||
      !('visitId' in payload) || typeof payload.visitId !== 'string' ||
      !uuidPattern.test(payload.visitId)
    ) throw new Error()
    return { visitedAt: payload.visitedAt, visitId: payload.visitId }
  } catch {
    throw new InvalidVisitCursorError('Visit cursor is invalid.')
  }
}

export function encodeVisitCursor(placeId: string, cursor: VisitCursor): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    kind: 'place-visits',
    placeId,
    ...cursor,
  }), 'utf8').toString('base64url')
}

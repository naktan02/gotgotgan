import { InvalidPublicProfileReportCursorError } from '../domain/safety.js'

export type PublicProfileReportCursor = Readonly<{ reportedAt: string; reportId: string }>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function decodePublicProfileReportCursor(
  value: string | undefined,
): PublicProfileReportCursor | undefined {
  if (value === undefined) return undefined
  try {
    const payload: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      !('v' in payload) || payload.v !== 1 ||
      !('kind' in payload) || payload.kind !== 'public-profile-reports' ||
      !('reportedAt' in payload) || typeof payload.reportedAt !== 'string' ||
      !Number.isFinite(Date.parse(payload.reportedAt)) ||
      !('reportId' in payload) || typeof payload.reportId !== 'string' ||
      !uuidPattern.test(payload.reportId)
    ) throw new Error()
    return { reportedAt: payload.reportedAt, reportId: payload.reportId }
  } catch {
    throw new InvalidPublicProfileReportCursorError('Public Profile report cursor is invalid')
  }
}

export function encodePublicProfileReportCursor(cursor: PublicProfileReportCursor): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    kind: 'public-profile-reports',
    ...cursor,
  }), 'utf8').toString('base64url')
}

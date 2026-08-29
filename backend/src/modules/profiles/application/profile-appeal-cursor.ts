import { createHash } from 'node:crypto'

import { InvalidPublicProfileAppealCursorError } from '../domain/appeals.js'

export type PublicProfileOwnerNoticeCursor = Readonly<{
  createdAt: string
  noticeId: string
}>

export type PublicProfileAppealQueueCursor = Readonly<{
  submittedAt: string
  appealId: string
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function decode(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidPublicProfileAppealCursorError('Public Profile appeal cursor is invalid')
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function ownerFingerprint(ownerMemberId: string): string {
  return createHash('sha256').update(ownerMemberId).digest('base64url')
}

export function encodePublicProfileOwnerNoticeCursor(
  cursor: PublicProfileOwnerNoticeCursor,
  ownerMemberId: string,
): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    kind: 'public-profile-owner-notices',
    ownerFingerprint: ownerFingerprint(ownerMemberId),
    ...cursor,
  }), 'utf8').toString('base64url')
}

export function decodePublicProfileOwnerNoticeCursor(
  value: string,
  ownerMemberId: string,
): PublicProfileOwnerNoticeCursor {
  const payload = decode(value)
  if (
    typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
    !('v' in payload) || payload.v !== 1 ||
    !('kind' in payload) || payload.kind !== 'public-profile-owner-notices' ||
    !('ownerFingerprint' in payload) || payload.ownerFingerprint !== ownerFingerprint(ownerMemberId) ||
    !('createdAt' in payload) || !validTimestamp(payload.createdAt) ||
    !('noticeId' in payload) || typeof payload.noticeId !== 'string' ||
    !uuidPattern.test(payload.noticeId)
  ) throw new InvalidPublicProfileAppealCursorError('Public Profile notice cursor is invalid')
  return {
    createdAt: payload.createdAt,
    noticeId: payload.noticeId,
  }
}

export function encodePublicProfileAppealQueueCursor(
  cursor: PublicProfileAppealQueueCursor,
): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    kind: 'public-profile-appeal-queue',
    ...cursor,
  }), 'utf8').toString('base64url')
}

export function decodePublicProfileAppealQueueCursor(
  value: string,
): PublicProfileAppealQueueCursor {
  const payload = decode(value)
  if (
    typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
    !('v' in payload) || payload.v !== 1 ||
    !('kind' in payload) || payload.kind !== 'public-profile-appeal-queue' ||
    !('submittedAt' in payload) || !validTimestamp(payload.submittedAt) ||
    !('appealId' in payload) || typeof payload.appealId !== 'string' ||
    !uuidPattern.test(payload.appealId)
  ) throw new InvalidPublicProfileAppealCursorError('Public Profile appeal cursor is invalid')
  return { submittedAt: payload.submittedAt, appealId: payload.appealId }
}

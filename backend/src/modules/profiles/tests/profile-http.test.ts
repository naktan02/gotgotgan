import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  registerProfileHttpRoutes,
  type PendingPublicProfileReport,
  type PublicProfileAppealAttempt,
  type PublicProfileAppealResolutionAttempt,
  type PublicProfileAppealStore,
  type PublicProfileAttempt,
  type PublicProfileModerationAttempt,
  type PublicProfileModerationOutcome,
  type PublicProfileModerationRecord,
  type PublicProfileOutcome,
  type PublicProfileOwnerNotice,
  type PublicProfileRecord,
  type PublicProfileReportAttempt,
  type PublicProfileReportOutcome,
  type PublicProfileSafetyStore,
  type PublicProfileStore,
  type PublishedProfileOwner,
} from '../index.js'

const memberId = '01992d20-0000-7000-8000-000000000001'
const reporterMemberId = '01992d20-0000-7000-8000-000000000004'
const moderatorMemberId = '01992d20-0000-7000-8000-000000000005'
const at = '2026-08-29T10:00:00.000Z'

class MemoryStore implements PublicProfileStore {
  profile?: PublicProfileRecord

  async apply(attempt: PublicProfileAttempt): Promise<PublicProfileOutcome> {
    this.profile = {
      handle: attempt.command.handle,
      displayName: attempt.command.displayName,
      visibility: attempt.command.visibility,
      createdAt: at,
      updatedAt: at,
    }
    return { status: 'applied' }
  }

  async getCurrent() { return this.profile }

  async getPublished(): Promise<PublishedProfileOwner | undefined> {
    return this.profile?.visibility === 'public'
      ? { ...this.profile, visibility: 'public', ownerMemberId: memberId }
      : undefined
  }
}

class MemorySafetyStore implements PublicProfileSafetyStore {
  reports: PendingPublicProfileReport[] = []
  moderation?: PublicProfileModerationRecord

  constructor(
    private readonly profiles: MemoryStore,
    private readonly appeals: MemoryAppealStore,
  ) {}

  async report(attempt: PublicProfileReportAttempt): Promise<PublicProfileReportOutcome> {
    if (this.profiles.profile?.visibility !== 'public' || this.moderation?.state === 'withheld') {
      return { status: 'target-not-found' }
    }
    if (attempt.reporterMemberId === memberId) return { status: 'self-report' }
    const sameId = this.reports.find((report) => report.reportId === attempt.reportId)
    if (sameId !== undefined) return { status: 'replayed' }
    if (this.reports.some((report) => report.handle === attempt.handle)) {
      return { status: 'already-reported' }
    }
    this.reports.push({
      reportId: attempt.reportId,
      handle: attempt.handle,
      reason: attempt.reason,
      reportedAt: attempt.occurredAt,
      expiresAt: attempt.expiresAt,
    })
    return { status: 'recorded' }
  }

  async getModeration(handle: string) {
    if (this.profiles.profile?.handle !== handle) return undefined
    return this.moderation ?? {
      handle,
      state: 'allowed' as const,
      reason: null,
      updatedAt: null,
    }
  }

  async moderate(attempt: PublicProfileModerationAttempt): Promise<PublicProfileModerationOutcome> {
    if (this.profiles.profile?.handle !== attempt.handle) return { status: 'target-not-found' }
    if (this.appeals.hasPending(attempt.handle)) return { status: 'appeal-pending' }
    this.moderation = {
      handle: attempt.handle,
      state: attempt.command.state,
      reason: attempt.command.reason,
      updatedAt: attempt.occurredAt,
    }
    this.appeals.recordModerationNotice(attempt)
    this.reports = []
    return { status: 'applied' }
  }

  async listPendingReports() { return this.reports }

  async deleteExpiredReports() { return 0 }
}

class MemoryAppealStore implements PublicProfileAppealStore {
  notices: PublicProfileOwnerNotice[] = []
  private readonly receipts = new Map<string, string>()
  private readonly resolutions = new Map<string, string>()

  hasPending(handle: string) {
    return this.notices.some((notice) => (
      notice.handle === handle && notice.appeal?.status === 'pending'
    ))
  }

  recordModerationNotice(attempt: PublicProfileModerationAttempt) {
    this.notices.unshift({
      noticeId: attempt.decisionId,
      handle: attempt.handle,
      kind: attempt.command.state === 'withheld' ? 'withheld' : 'restored',
      reason: attempt.command.reason,
      createdAt: attempt.occurredAt,
      acknowledgedAt: null,
      appeal: null,
    })
  }

  async listOwnerNotices() { return this.notices }

  async acknowledgeOwnerNotice(input: Readonly<{
    noticeId: string
    occurredAt: string
  }>) {
    const notice = this.notices.find((item) => item.noticeId === input.noticeId)
    if (notice === undefined) return { status: 'target-not-found' as const }
    if (notice.acknowledgedAt !== null) {
      return { status: 'already-acknowledged' as const, acknowledgedAt: notice.acknowledgedAt }
    }
    this.notices = this.notices.map((item) => item.noticeId === input.noticeId
      ? { ...item, acknowledgedAt: input.occurredAt }
      : item)
    return { status: 'acknowledged' as const, acknowledgedAt: input.occurredAt }
  }

  async submitAppeal(attempt: PublicProfileAppealAttempt) {
    const receipt = this.receipts.get(attempt.appealId)
    if (receipt !== undefined) {
      return { status: receipt === attempt.fingerprint ? 'replayed' as const : 'conflict' as const }
    }
    const notice = this.notices.find((item) => item.noticeId === attempt.noticeId)
    if (notice === undefined || notice.kind !== 'withheld') return { status: 'target-not-found' as const }
    if (notice.appeal !== null) return { status: 'already-appealed' as const }
    this.receipts.set(attempt.appealId, attempt.fingerprint)
    this.notices = this.notices.map((item) => item.noticeId === attempt.noticeId
      ? {
          ...item,
          acknowledgedAt: attempt.occurredAt,
          appeal: {
            appealId: attempt.appealId,
            reason: attempt.reason,
            status: 'pending' as const,
            submittedAt: attempt.occurredAt,
            resolvedAt: null,
            resolutionReason: null,
          },
        }
      : item)
    return { status: 'recorded' as const }
  }

  async listPendingAppeals() {
    return this.notices.flatMap((notice) => notice.appeal?.status === 'pending'
      ? [{
          appealId: notice.appeal.appealId,
          handle: notice.handle,
          reason: notice.appeal.reason,
          submittedAt: notice.appeal.submittedAt,
          moderationReason: 'spam' as const,
          moderationDecidedAt: notice.createdAt,
        }]
      : [])
  }

  async resolveAppeal(attempt: PublicProfileAppealResolutionAttempt) {
    const receipt = this.resolutions.get(attempt.resolutionId)
    if (receipt !== undefined) {
      return { status: receipt === attempt.fingerprint ? 'replayed' as const : 'conflict' as const }
    }
    const notice = this.notices.find((item) => item.appeal?.appealId === attempt.appealId)
    if (notice === undefined) return { status: 'target-not-found' as const }
    if (notice.appeal?.status !== 'pending') return { status: 'already-resolved' as const }
    this.resolutions.set(attempt.resolutionId, attempt.fingerprint)
    const accepted = attempt.command.outcome === 'accepted'
    const reason = accepted ? 'appeal-accepted' as const : attempt.command.reason
    this.notices = this.notices.map((item) => item.appeal?.appealId === attempt.appealId
      ? {
          ...item,
          appeal: {
            ...item.appeal,
            status: accepted ? 'accepted' as const : 'rejected' as const,
            resolvedAt: attempt.occurredAt,
            resolutionReason: reason,
          },
        }
      : item)
    this.notices.unshift({
      noticeId: attempt.resolutionId,
      handle: notice.handle,
      kind: accepted ? 'restored' : 'appeal-rejected',
      reason,
      createdAt: attempt.occurredAt,
      acknowledgedAt: null,
      appeal: null,
    })
    return { status: 'applied' as const }
  }
}

function fixture() {
  const app = Fastify({ logger: false })
  const store = new MemoryStore()
  const appeals = new MemoryAppealStore()
  const safety = new MemorySafetyStore(store, appeals)
  const collections = vi.fn(async () => ({
    items: [{
      publicationId: '01992d20-0000-7000-8000-000000000003',
      name: '전체 공개 목록', description: null, placeCount: 2, updatedAt: at,
    }],
  }))
  registerProfileHttpRoutes(app, {
    authorizer: async (authorization, permission) => {
      if (authorization === undefined) return { status: 'authentication-required' }
      if (authorization === 'Bearer good' && permission === 'library.share') {
        return { status: 'authorized', memberId }
      }
      if (authorization === 'Bearer good' && permission === 'profiles.appeal') {
        return { status: 'authorized', memberId }
      }
      if (authorization === 'Bearer reporter' && permission === 'profiles.report') {
        return { status: 'authorized', memberId: reporterMemberId }
      }
      if (authorization === 'Bearer moderator' && permission === 'profiles.moderate') {
        return { status: 'authorized', memberId: moderatorMemberId }
      }
      return { status: 'access-denied' }
    },
    store,
    safety,
    appeals,
    collections,
    now: () => new Date(at),
  })
  return { app, store, safety, appeals, collections }
}

describe('public profile HTTP', () => {
  it('requires share authority for settings and exposes only a published projection', async () => {
    const { app, collections } = fixture()
    const command = {
      commandId: '01992d20-0000-7000-8000-000000000002',
      profile: {
        handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', expectedUpdatedAt: null,
      },
    }
    expect((await app.inject({ method: 'PUT', url: '/v1/profiles/current', payload: command })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'PUT', url: '/v1/profiles/current', headers: { authorization: 'Bearer good' }, payload: command,
    })).statusCode).toBe(201)

    const response = await app.inject({ method: 'GET', url: '/v1/public/profiles/ramen-log?limit=20' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.json()).toMatchObject({
      handle: 'ramen-log', displayName: '라멘 기록', collections: [{ name: '전체 공개 목록' }],
    })
    expect(response.body).not.toContain(memberId)
    expect(collections).toHaveBeenCalledWith({ ownerMemberId: memberId, limit: 20 })
    await app.close()
  })

  it('returns the same not-found for hidden and unknown profiles', async () => {
    const { app, store } = fixture()
    store.profile = {
      handle: 'quiet-map', displayName: '조용한 지도', visibility: 'hidden', createdAt: at, updatedAt: at,
    }
    const hidden = await app.inject({ method: 'GET', url: '/v1/public/profiles/quiet-map' })
    const unknown = await app.inject({ method: 'GET', url: '/v1/public/profiles/unknown-map' })
    expect(hidden.statusCode).toBe(404)
    expect(unknown.statusCode).toBe(404)
    expect(hidden.json()).toMatchObject({ code: 'PLACE_PUBLIC_PROFILE_NOT_FOUND' })
    expect(unknown.json()).toMatchObject({ code: 'PLACE_PUBLIC_PROFILE_NOT_FOUND' })
    await app.close()
  })

  it('records redacted categorized reports and keeps moderation behind reviewer authority', async () => {
    const { app, store, safety } = fixture()
    store.profile = {
      handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', createdAt: at, updatedAt: at,
    }
    const report = {
      reportId: '01992d20-0000-7000-8000-000000000006',
      reason: 'spam',
    }
    const recorded = await app.inject({
      method: 'POST', url: '/v1/public/profiles/ramen-log/reports',
      headers: { authorization: 'Bearer reporter' }, payload: report,
    })
    expect(recorded.statusCode).toBe(201)
    expect(recorded.json()).toMatchObject({ status: 'recorded' })
    expect(recorded.body).not.toContain(reporterMemberId)
    expect((await app.inject({
      method: 'GET', url: '/v1/administration/public-profile-reports',
      headers: { authorization: 'Bearer reporter' },
    })).statusCode).toBe(403)

    const queue = await app.inject({
      method: 'GET', url: '/v1/administration/public-profile-reports',
      headers: { authorization: 'Bearer moderator' },
    })
    expect(queue.statusCode).toBe(200)
    expect(queue.json()).toMatchObject({ reports: [{ handle: 'ramen-log', reason: 'spam' }] })
    expect(queue.body).not.toContain(reporterMemberId)

    const moderation = await app.inject({
      method: 'GET', url: '/v1/administration/public-profiles/ramen-log/moderation',
      headers: { authorization: 'Bearer moderator' },
    })
    expect(moderation.json()).toMatchObject({ state: 'allowed', reason: null, updatedAt: null })
    const withheld = await app.inject({
      method: 'PUT', url: '/v1/administration/public-profiles/ramen-log/moderation',
      headers: { authorization: 'Bearer moderator' },
      payload: {
        decisionId: '01992d20-0000-7000-8000-000000000007',
        moderation: { state: 'withheld', reason: 'spam', expectedUpdatedAt: null },
      },
    })
    expect(withheld.statusCode).toBe(201)
    expect(safety.reports).toEqual([])
    await app.close()
  })

  it('gives the owner a redacted notice and resolves one structured appeal atomically', async () => {
    const { app, store } = fixture()
    store.profile = {
      handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', createdAt: at, updatedAt: at,
    }
    const decisionId = '01992d20-0000-7000-8000-000000000008'
    expect((await app.inject({
      method: 'PUT', url: '/v1/administration/public-profiles/ramen-log/moderation',
      headers: { authorization: 'Bearer moderator' },
      payload: {
        decisionId,
        moderation: { state: 'withheld', reason: 'spam', expectedUpdatedAt: null },
      },
    })).statusCode).toBe(201)

    const notices = await app.inject({
      method: 'GET', url: '/v1/profiles/current/moderation-notices',
      headers: { authorization: 'Bearer good' },
    })
    expect(notices.statusCode).toBe(200)
    expect(notices.json()).toMatchObject({
      notices: [{ noticeId: decisionId, kind: 'withheld', reason: 'spam', appeal: null }],
    })
    expect(notices.body).not.toContain(moderatorMemberId)

    const appealId = '01992d20-0000-7000-8000-000000000009'
    expect((await app.inject({
      method: 'POST', url: '/v1/profiles/current/moderation-appeals',
      headers: { authorization: 'Bearer good' },
      payload: { appealId, noticeId: decisionId, reason: 'mistaken-identity' },
    })).statusCode).toBe(201)
    expect((await app.inject({
      method: 'GET', url: '/v1/administration/public-profile-appeals',
      headers: { authorization: 'Bearer good' },
    })).statusCode).toBe(403)
    const queue = await app.inject({
      method: 'GET', url: '/v1/administration/public-profile-appeals',
      headers: { authorization: 'Bearer moderator' },
    })
    expect(queue.json()).toMatchObject({
      appeals: [{ appealId, handle: 'ramen-log', reason: 'mistaken-identity' }],
    })
    expect(queue.body).not.toContain(memberId)

    expect((await app.inject({
      method: 'PUT', url: '/v1/administration/public-profiles/ramen-log/moderation',
      headers: { authorization: 'Bearer moderator' },
      payload: {
        decisionId: '01992d20-0000-7000-8000-000000000010',
        moderation: {
          state: 'allowed', reason: 'insufficient-evidence', expectedUpdatedAt: at,
        },
      },
    })).json()).toMatchObject({ code: 'PLACE_PUBLIC_PROFILE_APPEAL_PENDING' })

    const resolutionId = '01992d20-0000-7000-8000-000000000011'
    expect((await app.inject({
      method: 'PUT', url: `/v1/administration/public-profile-appeals/${appealId}`,
      headers: { authorization: 'Bearer moderator' },
      payload: { resolutionId, resolution: { outcome: 'accepted' } },
    })).statusCode).toBe(201)
    const resolved = await app.inject({
      method: 'GET', url: '/v1/profiles/current/moderation-notices',
      headers: { authorization: 'Bearer good' },
    })
    expect(resolved.json()).toMatchObject({
      notices: [
        { noticeId: resolutionId, kind: 'restored', reason: 'appeal-accepted' },
        { noticeId: decisionId, appeal: { appealId, status: 'accepted' } },
      ],
    })
    await app.close()
  })

  it('fails closed when Profile persistence or its public Collection directory is unavailable', async () => {
    const { app, store, collections } = fixture()
    store.getCurrent = async () => { throw new Error('database unavailable') }
    const current = await app.inject({
      method: 'GET', url: '/v1/profiles/current', headers: { authorization: 'Bearer good' },
    })
    expect(current.statusCode).toBe(503)
    expect(current.json()).toMatchObject({ code: 'PLACE_PUBLIC_PROFILE_UNAVAILABLE' })

    store.apply = async () => { throw new Error('database unavailable') }
    const update = await app.inject({
      method: 'PUT', url: '/v1/profiles/current', headers: { authorization: 'Bearer good' },
      payload: {
        commandId: '01992d20-0000-7000-8000-000000000099',
        profile: {
          handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', expectedUpdatedAt: null,
        },
      },
    })
    expect(update.statusCode).toBe(503)
    expect(update.json()).toMatchObject({ code: 'PLACE_PUBLIC_PROFILE_UNAVAILABLE' })

    store.profile = {
      handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', createdAt: at, updatedAt: at,
    }
    collections.mockRejectedValueOnce(new Error('directory unavailable'))
    const published = await app.inject({ method: 'GET', url: '/v1/public/profiles/ramen-log' })
    expect(published.statusCode).toBe(503)
    expect(published.json()).toMatchObject({ code: 'PLACE_PUBLIC_PROFILE_UNAVAILABLE' })
    await app.close()
  })
})

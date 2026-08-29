import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  registerProfileHttpRoutes,
  type PendingPublicProfileReport,
  type PublicProfileAttempt,
  type PublicProfileModerationAttempt,
  type PublicProfileModerationOutcome,
  type PublicProfileModerationRecord,
  type PublicProfileOutcome,
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

  constructor(private readonly profiles: MemoryStore) {}

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
    this.moderation = {
      handle: attempt.handle,
      state: attempt.command.state,
      reason: attempt.command.reason,
      updatedAt: attempt.occurredAt,
    }
    this.reports = []
    return { status: 'applied' }
  }

  async listPendingReports() { return this.reports }

  async deleteExpiredReports() { return 0 }
}

function fixture() {
  const app = Fastify({ logger: false })
  const store = new MemoryStore()
  const safety = new MemorySafetyStore(store)
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
    collections,
    now: () => new Date(at),
  })
  return { app, store, safety, collections }
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

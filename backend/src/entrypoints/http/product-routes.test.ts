import { describe, expect, it } from 'vitest'

import type { LibraryStore, PublishedCollection } from '../../modules/library/index.js'
import type { VisitRecord, VisitStore } from '../../modules/visits/index.js'
import type { PublishedWriting, WritingStore } from '../../modules/writing/index.js'
import { buildHttpApplication } from './app.js'

const memberId = '01992d04-0000-7000-8000-000000000001'
const placeId = '01992d04-0000-7000-8000-000000000002'
const publicationId = '01992d04-0000-7000-8000-000000000003'
const now = () => new Date('2026-08-26T10:00:00.000Z')
const authorizer = async (authorization: string | undefined) => authorization === 'Bearer good'
  ? { status: 'authorized' as const, memberId }
  : { status: 'authentication-required' as const }

function fixtureApplication() {
  const library: LibraryStore = {
    apply: async () => ({ status: 'applied' }),
    getPlacePreferences: async () => ({ memberId, placeId, saved: true, wanted: false, personalRating: 4.4, updatedAt: now().toISOString() }),
    getPublishedCollection: async (id): Promise<PublishedCollection | undefined> => id === publicationId ? {
      publicationId,
      visibility: 'unlisted',
      name: 'Shared places',
      description: null,
      places: [{ placeId, position: 0 }],
      updatedAt: now().toISOString(),
    } : undefined,
    getMemberLibrary: async () => ({ places: [], collections: [], tags: [] }),
  }
  const visits: VisitStore = {
    append: async (_record: VisitRecord) => 'recorded',
    summarize: async () => ({ visited: true, count: 2, firstVisitedAt: '2026-07-01T12:00:00.000Z', lastVisitedAt: '2026-08-01T12:00:00.000Z' }),
    list: async () => [],
  }
  const writing: WritingStore = {
    apply: async (attempt) => ({ status: 'applied', documentId: attempt.command.documentId, version: 1 }),
    getPublished: async (id): Promise<PublishedWriting | undefined> => id === publicationId ? {
      kind: 'note',
      publicationId,
      visibility: 'public',
      body: '공개 메모',
      placeIds: [placeId],
      updatedAt: now().toISOString(),
    } : undefined,
    listMemberWriting: async () => [],
  }
  return buildHttpApplication({
    library: { authorizer, store: library, now },
    visits: { authorizer, store: visits, now },
    writing: { authorizer, store: writing, now },
  })
}

describe('Stage 4 product HTTP boundary', () => {
  it('takes member identity only from authorization', async () => {
    const application = fixtureApplication()
    const denied = await application.inject({ method: 'GET', url: `/v1/library/places/${placeId}` })
    expect(denied.statusCode).toBe(401)
    const allowed = await application.inject({ method: 'GET', url: `/v1/library/places/${placeId}`, headers: { authorization: 'Bearer good' } })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({ memberId, personalRating: 4.4 })
    await application.close()
  })

  it('keeps owner library, writing, and visit occurrence reads authenticated', async () => {
    const application = fixtureApplication()
    for (const url of ['/v1/library', '/v1/writing', `/v1/places/${placeId}/visits`]) {
      expect((await application.inject({ method: 'GET', url })).statusCode).toBe(401)
      expect((await application.inject({ method: 'GET', url, headers: { authorization: 'Bearer good' } })).statusCode).toBe(200)
    }
    await application.close()
  })

  it('rejects actor and role fields on mutation commands', async () => {
    const application = fixtureApplication()
    const response = await application.inject({
      method: 'POST',
      url: '/v1/library/commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        commandId: '01992d04-0000-7000-8000-000000000010',
        memberId,
        role: 'owner',
        command: { kind: 'set-place-preferences', placeId, saved: true, wanted: false, personalRating: 4.4 },
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'PLACE_LIBRARY_COMMAND_INVALID' })
    await application.close()
  })

  it('exposes allowlisted public projections and hides unknown/private identifiers', async () => {
    const application = fixtureApplication()
    const collection = await application.inject({ method: 'GET', url: `/v1/public/collections/${publicationId}` })
    expect(collection.statusCode).toBe(200)
    expect(collection.json()).toEqual({
      publicationId,
      visibility: 'unlisted',
      name: 'Shared places',
      description: null,
      places: [{ placeId, position: 0 }],
      updatedAt: now().toISOString(),
    })
    const absent = await application.inject({ method: 'GET', url: '/v1/public/collections/01992d04-0000-7000-8000-000000000099' })
    expect(absent.statusCode).toBe(404)
    expect(absent.json()).not.toHaveProperty('memberId')
    const writing = await application.inject({ method: 'GET', url: `/v1/public/writing/${publicationId}` })
    expect(writing.json()).not.toHaveProperty('memberId')
    await application.close()
  })

  it('records repeat visits and returns a derived summary', async () => {
    const application = fixtureApplication()
    const recorded = await application.inject({
      method: 'POST',
      url: '/v1/visits',
      headers: { authorization: 'Bearer good' },
      payload: { id: '01992d04-0000-7000-8000-000000000020', placeId, visitedAt: '2026-08-01T12:00:00.000Z' },
    })
    expect(recorded.statusCode).toBe(201)
    const summary = await application.inject({ method: 'GET', url: `/v1/places/${placeId}/visit-summary`, headers: { authorization: 'Bearer good' } })
    expect(summary.json()).toMatchObject({ visited: true, count: 2 })
    await application.close()
  })
})

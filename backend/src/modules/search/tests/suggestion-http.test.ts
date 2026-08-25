import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

import { registerSearchHttpRoutes } from '../index.js'

const suggestionId = '01992d20-5000-7000-8000-000000000001'
const sessionId = '01992d20-5000-7000-8000-000000000002'
const placeId = '01992d20-5000-7000-8000-000000000003'

function application() {
  const suggest = vi.fn(async () => ({
    schemaVersion: 'place-suggestions.v1' as const,
    sessionId,
    items: [{
      suggestionId,
      identity: { kind: 'provider' as const, providerKey: 'google' as const, providerPlaceId: 'provider-place-1' },
      source: {
        key: 'google', label: 'Google Maps', detailsAvailable: true,
        attributions: [{ label: 'Google Maps' }],
      },
      name: 'Senkai Ramen',
      areaLabel: 'Fukuoka, Japan',
      location: null,
      categoryLabel: 'Ramen restaurant',
      observedAt: '2026-08-26T10:00:00.000Z',
    }],
    sources: [{ sourceKey: 'google', status: 'complete' as const, resultCount: 1 }],
  }))
  const select = vi.fn(async () => ({
    schemaVersion: 'place-suggestion-selection.v1' as const,
    suggestionId,
    status: 'recorded' as const,
    observationId: '01992d20-5000-7000-8000-000000000004',
  }))
  const materialize = vi.fn(async () => ({
    schemaVersion: 'place-suggestion-materialization.v1' as const,
    suggestionId,
    status: 'created' as const,
    canonicalPlaceId: placeId,
  }))
  const app = Fastify({ logger: false })
  registerSearchHttpRoutes(app, {
    search: async () => ({ schemaVersion: 'place-search.v1', items: [], sources: [] }),
    authorizer: async (authorization) => authorization === 'Bearer good'
      ? { status: 'authorized', memberId: '01992d20-5000-7000-8000-000000000005' }
      : { status: 'authentication-required' },
    suggestions: { suggest, select, materialize },
  })
  return { app, suggest, select, materialize }
}

describe('Place suggestion HTTP boundary', () => {
  it('accepts a reusable public session without exposing provider session material', async () => {
    const { app, suggest } = application()
    const response = await app.inject({
      method: 'POST', url: '/v1/search/suggestions',
      payload: { schemaVersion: 'place-suggestions.v1', query: '센카이', sessionId, limit: 8 },
    })

    expect(response.statusCode).toBe(200)
    expect(suggest).toHaveBeenCalledWith({ query: '센카이', sessionId, limit: 8 })
    expect(response.json()).toMatchObject({ sessionId, items: [{ suggestionId }] })
    expect(response.body).not.toMatch(/token|apiKey|cookie|profile/i)
    await app.close()
  })

  it('records public selection but requires member authorization for canonical materialization', async () => {
    const { app, select, materialize } = application()
    const selection = await app.inject({
      method: 'POST', url: '/v1/search/suggestion-selections',
      payload: { schemaVersion: 'place-suggestion-selection.v1', suggestionId },
    })
    expect(selection.statusCode).toBe(200)
    expect(select).toHaveBeenCalledWith(suggestionId)

    const denied = await app.inject({
      method: 'POST', url: '/v1/search/suggestion-materializations',
      payload: { schemaVersion: 'place-suggestion-materialization.v1', suggestionId, intent: 'save' },
    })
    expect(denied.statusCode).toBe(401)
    expect(materialize).not.toHaveBeenCalled()

    const allowed = await app.inject({
      method: 'POST', url: '/v1/search/suggestion-materializations',
      headers: { authorization: 'Bearer good' },
      payload: { schemaVersion: 'place-suggestion-materialization.v1', suggestionId, intent: 'save' },
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toEqual({
      schemaVersion: 'place-suggestion-materialization.v1', suggestionId,
      status: 'created', canonicalPlaceId: placeId,
    })
    await app.close()
  })

  it('rejects actor injection and invalid suggestion bodies at the contract boundary', async () => {
    const { app } = application()
    const response = await app.inject({
      method: 'POST', url: '/v1/search/suggestion-materializations',
      headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'place-suggestion-materialization.v1', suggestionId,
        intent: 'save', memberId: '01992d20-5000-7000-8000-000000000099',
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'PLACE_SUGGESTION_MATERIALIZATION_INVALID' })
    await app.close()
  })
})

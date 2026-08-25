import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildHttpApplication } from '../src/entrypoints/http/app.js'

const applications: ReturnType<typeof buildHttpApplication>[] = []

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()))
})

describe('provider place detail HTTP interface', () => {
  it('validates and returns a bounded lazy detail projection', async () => {
    const getDetail = vi.fn(async () => ({
      schemaVersion: 'place-provider-detail.v1' as const,
      providerKey: 'google' as const,
      providerPlaceId: 'google-place-100',
      name: '성수 라멘 연구소', address: null, location: null, categoryLabel: null,
      photos: [{ authorAttributions: [{ label: '사진 작성자' }] }],
      attributions: [{ label: 'Google Maps' }],
      observedAt: '2026-08-26T10:00:00.000Z',
    }))
    const application = buildHttpApplication({
      providers: { getDetail, supportedProviders: ['google'] },
    })
    applications.push(application)

    const response = await application.inject({
      method: 'POST', path: '/v1/providers/place-details',
      payload: {
        schemaVersion: 'place-provider-detail.v1',
        providerKey: 'google', providerPlaceId: 'google-place-100',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(getDetail).toHaveBeenCalledWith({
      providerKey: 'google', providerPlaceId: 'google-place-100',
    })
    expect(response.json()).not.toHaveProperty('apiKey')
  })

  it('rejects unsupported detail providers without invoking an adapter', async () => {
    const getDetail = vi.fn(async () => { throw new Error('must not run') })
    const application = buildHttpApplication({
      providers: { getDetail, supportedProviders: ['google'] },
    })
    applications.push(application)

    const response = await application.inject({
      method: 'POST', path: '/v1/providers/place-details',
      payload: {
        schemaVersion: 'place-provider-detail.v1',
        providerKey: 'naver', providerPlaceId: 'undocumented-id',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'PLACE_PROVIDER_DETAIL_UNSUPPORTED' })
    expect(getDetail).not.toHaveBeenCalled()
  })
})

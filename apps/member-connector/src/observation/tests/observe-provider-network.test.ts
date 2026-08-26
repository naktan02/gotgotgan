import { describe, expect, it } from 'vitest'

import { observeProviderNetwork } from '../application/observe-provider-network.js'

describe('member connector network observation interface', () => {
  it('returns bounded response shapes without provider values, query data, or opaque path identities', async () => {
    const report = await observeProviderNetwork({
      providerKey: 'naver',
      targetUrl: 'https://map.naver.com/',
      allowedOrigins: ['https://pcmap-api.place.naver.com'],
      maximumBodyBytes: 65_536,
      browser: {
        observe: async () => ({
          startedAt: '2026-08-26T15:00:00.000Z',
          finishedAt: '2026-08-26T15:00:05.000Z',
          responses: [{
            method: 'GET',
            url: 'https://pcmap-api.place.naver.com/api/v1/folders/123456789/bookmarks?cursor=private-cursor&start=0&limit=20&sort=lastUseTime&folderType=all',
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: {
              folderName: '후쿠오카 여행',
              accessToken: 'provider-secret-token',
              bookmarks: [{
                id: 'opaque-bookmark-id',
                name: '센카이 라멘',
                address: '후쿠오카시 하카타구',
                category: '라멘',
              }],
              'dynamic-user-01992d20': { email: 'person@example.com' },
            },
          }, {
            method: 'POST',
            url: 'https://new-api.place.naver.com/private/discovery?account=hidden',
            status: 204,
            contentType: 'application/json',
            body: { privateValue: 'must-not-be-inspected-before-origin-opt-in' },
          }],
        }),
      },
      signal: AbortSignal.timeout(1_000),
    })

    expect(report).toEqual({
      schemaVersion: 'place-member-connector-observation.v1',
      providerKey: 'naver',
      startedAt: '2026-08-26T15:00:00.000Z',
      finishedAt: '2026-08-26T15:00:05.000Z',
      responses: [{
        method: 'GET',
        origin: 'https://pcmap-api.place.naver.com',
        pathTemplate: '/api/v1/{segment}/{number}/{segment}',
        queryKeys: ['cursor', 'folderType', 'limit', 'sort', 'start'],
        paginationParameters: {
          folderType: 'all',
          limit: 20,
          sort: 'lastUseTime',
          start: 0,
        },
        status: 200,
        contentType: 'application/json',
        bodyShape: {
          folderName: 'string',
          '{sensitive}': 'redacted',
          bookmarks: [{
            id: 'string',
            name: 'string',
            address: 'string',
            category: 'string',
          }],
          '{dynamic-key}': { '{sensitive}': 'redacted' },
        },
      }, {
        method: 'POST',
        origin: 'https://new-api.place.naver.com',
        pathTemplate: '/{segment}/{segment}',
        queryKeys: ['{sensitive}'],
        status: 204,
        contentType: 'application/json',
      }],
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/후쿠오카|센카이|하카타|provider-secret|private-cursor|person@example|must-not-be-inspected/)
    expect(serialized).not.toContain('123456789')
    expect(report.responses.map((response) => response.pathTemplate).join('')).not.toMatch(
      /folders|bookmarks|private|discovery/i,
    )
  })
})

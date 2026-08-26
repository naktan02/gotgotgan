import { describe, expect, it, vi } from 'vitest'

import { describeMemberConnector, runMemberConnectorCommand } from './run-command.js'

describe('member connector CLI interface', () => {
  it('describes only source-only local capabilities', () => {
    expect(describeMemberConnector()).toEqual({
      process: 'member-connector',
      service: 'place',
      state: 'source-only',
      provider: 'naver',
      capabilities: [
        'dedicated-profile-login',
        'redacted-network-observation',
        'full-saved-place-collection',
      ],
      captureSubmission: 'not-integrated',
      liveAcquisition: 'integration-gated',
    })
  })

  it('returns only a report identity and count after a redacted observation', async () => {
    let saved: unknown
    const browser = {
      openLogin: vi.fn(),
      observe: vi.fn(async () => ({
        startedAt: '2026-08-26T15:00:00.000Z',
        finishedAt: '2026-08-26T15:00:05.000Z',
        responses: [{
          method: 'GET',
          url: 'https://map.naver.com/api/bookmarks?cursor=private',
          status: 200,
          contentType: 'application/json',
          body: { name: '개인 장소명' },
        }],
      })),
    }
    const result = await runMemberConnectorCommand({
      config: {
        command: 'observe-naver',
        providerKey: 'naver',
        profileRoot: 'C:/private/profile',
        reportRoot: 'C:/private/reports',
        targetUrl: 'https://map.naver.com/',
        allowedOrigins: ['https://map.naver.com'],
        observationMilliseconds: 5_000,
        maximumBodyBytes: 65_536,
      },
      browser,
      reportStore: { write: vi.fn(async (input) => { saved = input; return { reportId: input.reportId } }) },
      nextId: () => '01992d22-1000-7000-8000-000000000002',
      signal: AbortSignal.timeout(1_000),
    })

    expect(result).toEqual({
      operation: 'naver-network-observation',
      status: 'completed',
      reportId: '01992d22-1000-7000-8000-000000000002',
      responseCount: 1,
    })
    expect(JSON.stringify(saved)).not.toMatch(/개인 장소명|private|profileRoot|reportRoot/)
  })

  it('collects all local saved places but exposes only aggregate counts', async () => {
    const result = await runMemberConnectorCommand({
      config: {
        command: 'collect-naver',
        providerKey: 'naver',
        profileRoot: 'C:/private/profile',
        apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
        sessionUrl: 'https://pages.map.naver.com/save-pages/pc/all-list',
        requestTimeoutMilliseconds: 15_000,
        maximumResponseBytes: 8_388_608,
        folderPageSize: 20,
        bookmarkPageSize: 500,
        maximumLists: 500,
        maximumBookmarks: 100_000,
        requestDelayMilliseconds: 100,
      },
      browser: { openLogin: vi.fn(), observe: vi.fn() },
      collector: {
        collectAll: vi.fn(async () => ({
          lists: [{
            listId: 'private-list-id',
            name: '개인 목록명',
            bookmarks: [{ bookmarkId: 'private-bookmark', name: '개인 장소명' }],
          }],
          summary: { listCount: 1, bookmarkCount: 1, requestCount: 2 },
        })),
      },
      nextId: vi.fn(),
      signal: AbortSignal.timeout(1_000),
    })

    expect(result).toEqual({
      operation: 'naver-saved-place-collection',
      status: 'completed',
      listCount: 1,
      bookmarkCount: 1,
      requestCount: 2,
      captureSubmission: 'not-integrated',
    })
    expect(JSON.stringify(result)).not.toMatch(/개인|private/)
  })
})

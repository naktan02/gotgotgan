import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import {
  NaverSavedPlaceSource,
  parseNaverSavedPlaceCapture,
} from '../index.js'

const fixtureUrl = new URL('./fixtures/naver-saved-place-capture.json', import.meta.url)

describe('NAVER saved-place capture parser', () => {
  it('normalizes the approved redacted capture without leaking account data', async () => {
    const body = new Uint8Array(await readFile(fixtureUrl))
    const result = parseNaverSavedPlaceCapture({
      body,
      contentType: 'application/json' as const,
      observedAt: '2026-08-26T11:00:00.000Z',
    })

    expect(result).toMatchObject({
      kind: 'page',
      items: [{
        sourceItemKey: 'list_fixture_001:bookmark_fixture_001',
        sourceListId: 'list_fixture_001',
        sourceItemId: 'bookmark_fixture_001',
        sourceListPosition: 0,
        sourcePosition: 0,
        providerPlaceId: 'place_fixture_001',
        listName: '후쿠오카 여행',
        name: '센카이 라멘',
        address: '일본 후쿠오카현 후쿠오카시',
        categoryLabel: '라멘',
        location: { latitude: 33.5902, longitude: 130.4207 },
        reviewReasons: [],
      }],
      nextCursor: 'cursor_fixture_002',
    })
    expect(JSON.stringify(result)).not.toContain('account')
    expect(JSON.stringify(result)).not.toContain('cookie')
  })

  it.each([
    ['login', 'provider-auth-expired'],
    ['mfa', 'provider-mfa-required'],
    ['captcha', 'provider-captcha-required'],
    ['consent', 'provider-consent-required'],
  ] as const)('classifies %s without parsing place data', (challenge, code) => {
    const body = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 'place-naver-saved-capture.v1',
      kind: 'challenge',
      challenge,
    }))
    expect(parseNaverSavedPlaceCapture({
      body, contentType: 'application/json', observedAt: '2026-08-26T11:00:00.000Z',
    })).toEqual({ kind: 'needs-user-action', code })
  })

  it('classifies rate limiting as a retryable provider failure', () => {
    const body = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 'place-naver-saved-capture.v1',
      kind: 'challenge',
      challenge: 'rate-limit',
    }))
    expect(parseNaverSavedPlaceCapture({
      body, contentType: 'application/json', observedAt: '2026-08-26T11:00:00.000Z',
    })).toEqual({ kind: 'failure', code: 'provider-rate-limited', retryable: true })
  })

  it('classifies schema drift and makes the source pass only opaque references to acquisition', async () => {
    const invalidBody = new TextEncoder().encode('{"unknown":true}')
    expect(parseNaverSavedPlaceCapture({
      body: invalidBody, contentType: 'application/json', observedAt: '2026-08-26T11:00:00.000Z',
    })).toEqual({ kind: 'needs-user-action', code: 'provider-parser-drift' })

    const body = new Uint8Array(await readFile(fixtureUrl))
    const capture = vi.fn(async () => ({
      body,
      checksum: createHash('sha256').update(body).digest('hex'),
      contentType: 'application/json' as const,
      acquisitionKind: 'browser-network' as const,
      observedAt: '2026-08-26T11:00:00.000Z',
    }))
    const source = new NaverSavedPlaceSource({ capture })
    await source.readPage({
      connection: {
        connectionId: 'connection-fixture',
        providerKey: 'naver',
        profileReference: 'profile:fixture',
      },
      cursor: null,
      limit: 100,
      signal: AbortSignal.timeout(1000),
    })
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      profileReference: 'profile:fixture',
      cursor: null,
      limit: 100,
    }))
    expect(JSON.stringify(capture.mock.calls)).not.toContain('password')
  })
})

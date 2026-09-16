import { describe, expect, it, vi } from 'vitest'

import {
  NaverTraceForgePlaceDetailSource,
  type ForgeRecipeClient,
} from '../index.js'

const at = '2026-09-02T00:00:00.000Z'

function source(client: ForgeRecipeClient) {
  return new NaverTraceForgePlaceDetailSource({
    client,
    now: () => new Date(at),
    packId: 'naver',
    packVersion: '0.1.0',
    parserVersion: 'naver-place-detail-dom.v1',
    recipeId: 'map-place-detail-dom',
  })
}

describe('NAVER TraceForge place detail source', () => {
  it('is explicitly bound to NAVER', () => {
    const client: ForgeRecipeClient = {
      run: vi.fn(async () => ({
        outputs: { name: 'NAVER fixture' },
        state: 'succeeded' as const,
        version: 1 as const,
      })),
    }

    expect(source(client).providerKey).toBe('naver')
  })

  it('maps bounded Pack outputs to an immutable provider detail snapshot', async () => {
    const controller = new AbortController()
    const client: ForgeRecipeClient = {
      run: vi.fn(async () => ({
        outputs: {
          address: '서울 중구 퇴계로 101',
          'content-lines': ['주소', '서울 중구 퇴계로 101'],
          homepage: 'https://www.example.com/',
          images: ['https://images.example.com/one.jpg'],
          name: '스타벅스 명동역점',
          'opening-detail': '매장 07:00에 영업 시작',
          'opening-status': '영업 전',
          phone: '1522-3232복사',
          'primary-image': 'https://images.example.com/main.jpg',
          summary: '방문자리뷰 3,167',
        },
        state: 'succeeded' as const,
        version: 1 as const,
      })),
    }

    await expect(source(client).fetch({
      providerPlaceId: '31806828',
      signal: controller.signal,
    })).resolves.toEqual({
      kind: 'available',
      detail: {
        acquisitionKind: 'browser-dom',
        payloadChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        parserVersion: 'naver-place-detail-dom.v1',
        observedAt: at,
        name: '스타벅스 명동역점',
        address: '서울 중구 퇴계로 101',
        categoryLabel: null,
        location: null,
        attributes: {
          address: '서울 중구 퇴계로 101',
          contentLines: ['주소', '서울 중구 퇴계로 101'],
          homepage: 'https://www.example.com/',
          images: ['https://images.example.com/one.jpg'],
          name: '스타벅스 명동역점',
          openingDetail: '매장 07:00에 영업 시작',
          openingStatus: '영업 전',
          phone: '1522-3232',
          primaryImage: 'https://images.example.com/main.jpg',
          summary: '방문자리뷰 3,167',
        },
        confidence: 0.85,
      },
    })
    expect(client.run).toHaveBeenCalledWith({
      inputs: { 'place-id': '31806828' },
      packId: 'naver',
      packVersion: '0.1.0',
      recipeId: 'map-place-detail-dom',
      version: 1,
    }, controller.signal)
  })

  it('passes cancellation to the Runner client seam', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const client: ForgeRecipeClient = {
      run: vi.fn(async (_request, signal) => {
        receivedSignal = signal
        return await new Promise<Awaited<ReturnType<ForgeRecipeClient['run']>>>((resolve) => {
          signal.addEventListener('abort', () => resolve({
            code: 'timed-out',
            message: 'aborted',
            state: 'failed' as const,
            version: 1 as const,
          }), { once: true })
        })
      }),
    }

    const result = source(client).fetch({
      providerPlaceId: '31806828',
      signal: controller.signal,
    })
    controller.abort()

    await expect(result).resolves.toEqual({
      code: 'provider-unavailable',
      kind: 'failure',
      retryable: true,
    })
    expect(receivedSignal).toBe(controller.signal)
    expect(receivedSignal?.aborted).toBe(true)
  })

  it.each([
    ['rate-limited', 'provider-rate-limited', true],
    ['source-unavailable', 'provider-unavailable', true],
    ['challenge-required', 'provider-interaction-required', false],
    ['response-invalid', 'provider-parser-drift', false],
  ])('maps %s without exposing the Runner message', async (code, expectedCode, retryable) => {
    const client: ForgeRecipeClient = {
      run: vi.fn(async () => ({
        code,
        message: 'sensitive upstream detail',
        state: code === 'challenge-required' ? 'needs-user-action' as const : 'failed' as const,
        version: 1 as const,
      })),
    }

    await expect(source(client).fetch({
      providerPlaceId: '31806828',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      code: expectedCode,
      kind: 'failure',
      retryable,
    })
  })

  it('fails as parser drift when required or bounded outputs are invalid', async () => {
    const client: ForgeRecipeClient = {
      run: vi.fn(async () => ({
        outputs: { name: '', images: new Array(101).fill('https://example.com/image') },
        state: 'succeeded' as const,
        version: 1 as const,
      })),
    }

    await expect(source(client).fetch({
      providerPlaceId: '31806828',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      code: 'provider-parser-drift',
      kind: 'failure',
      retryable: false,
    })
  })
})

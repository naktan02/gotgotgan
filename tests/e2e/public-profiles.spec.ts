import { expect, test, type Route } from '@playwright/test'

const profileCollectionId = '01992d20-0000-7000-8000-000000000005'

function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(value),
  })
}

test('creates a stable public profile through authenticated settings', async ({ page }) => {
  const commands: unknown[] = []
  let profile: Record<string, unknown> | undefined
  await page.route('**/api/profile/moderation-notices**', (route) => json(route, {
    schemaVersion: 'public-profile-moderation-notices.v1', notices: [],
  }))
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() === 'GET') {
      if (profile === undefined) {
        return json(route, {
          type: 'urn:place:error:public-profile-not-found',
          title: 'Public Profile not found', status: 404,
          code: 'PLACE_PUBLIC_PROFILE_NOT_FOUND', retryable: false,
          correlationRef: 'e2e-profile-missing',
        }, 404)
      }
      return json(route, profile)
    }
    const request = route.request().postDataJSON()
    commands.push(request)
    profile = {
      schemaVersion: 'public-profile-record.v1',
      handle: request.profile.handle,
      displayName: request.profile.displayName,
      visibility: request.profile.visibility,
      createdAt: '2026-08-29T10:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
    }
    return json(route, { schemaVersion: 'public-profile-command-result.v1', status: 'applied' }, 201)
  })

  await page.goto('/profile')
  await page.getByLabel('공개 핸들').fill('ramen-log')
  await page.getByLabel('표시 이름').fill('라멘 기록')
  await page.getByLabel(/공개 —/).check()
  await page.getByRole('button', { name: '프로필 저장' }).click()

  await expect(page.getByLabel('공개 핸들')).toBeDisabled()
  await expect(page.getByRole('link', { name: '내 공개 프로필 보기' }))
    .toHaveAttribute('href', '/people/ramen-log')
  expect(commands).toHaveLength(1)
  expect(commands[0]).toMatchObject({
    commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    profile: {
      handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', expectedUpdatedAt: null,
    },
  })
  expect(commands[0]).not.toHaveProperty('memberId')
})

test('acknowledges an owner moderation notice and submits one categorized appeal', async ({ page }) => {
  const noticeId = '01992d20-0000-7000-8000-000000000010'
  const appealBodies: unknown[] = []
  let acknowledgedAt: string | null = null
  let appeal: Record<string, unknown> | null = null

  await page.route('**/api/profile', (route) => json(route, {
    schemaVersion: 'public-profile-record.v1',
    handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public',
    createdAt: '2026-08-29T10:00:00.000Z', updatedAt: '2026-08-29T10:00:00.000Z',
  }))
  await page.route('**/api/profile/moderation-notices**', async (route) => {
    if (route.request().url().endsWith('/acknowledgement')) {
      acknowledgedAt = '2026-08-30T10:01:00.000Z'
      return json(route, {
        schemaVersion: 'public-profile-notice-acknowledgement.v1',
        status: 'acknowledged', acknowledgedAt,
      }, 201)
    }
    return json(route, {
      schemaVersion: 'public-profile-moderation-notices.v1',
      notices: [{
        noticeId,
        handle: 'ramen-log',
        kind: 'withheld',
        reason: 'privacy',
        createdAt: '2026-08-30T10:00:00.000Z',
        acknowledgedAt,
        appeal,
      }],
    })
  })
  await page.route('**/api/profile/moderation-appeals', async (route) => {
    const body = route.request().postDataJSON()
    appealBodies.push(body)
    if (appealBodies.length === 1) {
      return json(route, {
        type: 'urn:place:error:public-profile-appeal-unavailable',
        title: 'Public Profile appeal is temporarily unavailable', status: 503,
        code: 'PLACE_PUBLIC_PROFILE_APPEAL_UNAVAILABLE', retryable: true,
        correlationRef: 'e2e-profile-appeal-unavailable',
      }, 503)
    }
    appeal = {
      appealId: body.appealId,
      reason: body.reason,
      status: 'pending',
      submittedAt: '2026-08-30T10:02:00.000Z',
      resolvedAt: null,
      resolutionReason: null,
    }
    return json(route, {
      schemaVersion: 'public-profile-appeal-result.v1', status: 'recorded',
    }, 201)
  })

  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: '프로필 검토 알림' })).toBeVisible()
  await expect(page.getByText('개인정보 노출 우려')).toBeVisible()

  await page.getByRole('button', { name: '알림 확인' }).click()
  await expect(page.getByText('확인함')).toBeVisible()

  await page.getByLabel('다시 검토할 사유').selectOption('mistaken-identity')
  await page.getByRole('button', { name: '이의 제기 제출' }).click()
  await expect(page.getByText('프로필 검토 요청을 처리하지 못했습니다.')).toBeVisible()
  await page.getByRole('button', { name: '이의 제기 제출' }).click()
  await expect(page.getByText('이의 제기: 검토 중')).toBeVisible()
  await expect(page.getByRole('button', { name: '이의 제기 제출' })).toHaveCount(0)

  expect(appealBodies).toHaveLength(2)
  expect(appealBodies[0]).toMatchObject({
    appealId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    noticeId,
    reason: 'mistaken-identity',
  })
  expect(appealBodies[1]).toEqual(appealBodies[0])
  expect(JSON.stringify(appealBodies[0])).not.toMatch(/member|role|operator|freeText/i)
})

test('renders only public Collections on a noindex anonymous profile', async ({ page, request }) => {
  await page.goto('/people/ramen-log')

  await expect(page.getByRole('heading', { name: '라멘 기록' })).toBeVisible()
  await expect(page.getByText('@ramen-log')).toBeVisible()
  await expect(page.getByRole('link', { name: /서울 라멘 공개 목록/ }))
    .toHaveAttribute('href', `/share/collections/${profileCollectionId}`)
  await expect(page.locator('body')).not.toContainText('성수에서 다시 갈 곳')
  await expect(page.locator('body')).not.toContainText('membership')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

  await page.getByRole('button', { name: '컬렉션 더 보기' }).click()
  await expect(page.getByRole('link', { name: /동네 카페 공개 목록/ })).toBeVisible()

  const bff = await request.get('/api/public/profiles/ramen-log?limit=20')
  expect(bff.status()).toBe(200)
  expect(bff.headers()['x-robots-tag']).toBe('noindex, nofollow')
  expect(JSON.stringify(await bff.json())).not.toContain('membership')
})

test('keeps the profile panels inside a dedicated narrow-screen scroll surface', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile profile scroll ownership coverage')
  await page.setViewportSize({ width: 360, height: 800 })
  await page.route('**/api/profile/moderation-notices**', (route) => json(route, {
    schemaVersion: 'public-profile-moderation-notices.v1',
    notices: Array.from({ length: 3 }, (_, index) => ({
      noticeId: `01992d20-0000-7000-8000-00000000001${index}`,
      handle: 'ramen-log', kind: 'withheld', reason: 'privacy',
      createdAt: '2026-08-30T10:00:00.000Z', acknowledgedAt: null, appeal: null,
    })),
  }))
  await page.route('**/api/profile', (route) => json(route, {
    schemaVersion: 'public-profile-record.v1',
    handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public',
    createdAt: '2026-08-29T10:00:00.000Z', updatedAt: '2026-08-29T10:00:00.000Z',
  }))
  await page.goto('/profile')

  const scrollSurface = page.getByRole('region', { name: '프로필 설정 및 알림' })
  await expect(scrollSurface).toBeVisible()
  const dimensions = await scrollSurface.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)
  await scrollSurface.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scrollSurface.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

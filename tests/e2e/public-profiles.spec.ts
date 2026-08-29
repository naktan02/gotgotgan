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

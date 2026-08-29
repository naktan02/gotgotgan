import { expect, test } from '@playwright/test'

const configuredBaseUrl = process.env.PLACE_WEB_E2E_BASE_URL
if (configuredBaseUrl === undefined) throw new Error('PLACE_WEB_E2E_BASE_URL is required')
const webUrl = new URL(configuredBaseUrl)
const backendOrigin = `http://${webUrl.hostname}:${Number(webUrl.port) + 1}`

async function submitSearch(page: import('@playwright/test').Page, query: string) {
  const input = page.getByLabel('장소 검색어')
  await input.fill(query)
  await input.press('Enter')
}

test('coordinates search list, map selection, filters, bounds, and cursor pagination', async ({ page }) => {
  await page.goto('/search')
  await expect(page.getByRole('heading', { name: '장소 찾기' })).toBeVisible()
  const results = page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')
  await expect(results).toHaveCount(3)

  await results.nth(1).click()
  if (await page.getByRole('button', { name: '지도', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '지도', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: /긴 이름으로.*지도에서 선택/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '조용한 라멘 연구소 지도에서 선택' }).click()

  if (await page.getByRole('button', { name: '목록', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '목록', exact: true }).click()
  }
  await expect(results.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '결과 더 보기' }).click()
  await expect(results).toHaveCount(6)

  await page.getByLabel('장소 분류').selectOption('food.noodle.ramen')
  await expect(results).toHaveCount(2)
  await expect(page.getByText('골목 라멘')).toBeVisible()

  await page.getByLabel('장소 분류').selectOption('')
  if (await page.getByRole('button', { name: '지도', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '지도', exact: true }).click()
  }
  await page.getByRole('button', { name: '동쪽으로 이동' }).click()
  await page.getByRole('button', { name: '이 영역 검색' }).click()
  if (await page.getByRole('button', { name: '목록', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '목록', exact: true }).click()
  }
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('동쪽 기록 보관소')
  await expect(page.getByText('지도 영역 적용됨')).toBeVisible()
})

test('debounces typing and cancels the superseded backend request', async ({ page, request }) => {
  await page.goto('/search')
  await expect(page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')).toHaveCount(3)
  await submitSearch(page, '느린 검색')

  await expect.poll(async () => {
    const response = await request.get(`${backendOrigin}/__test/search-observations`)
    return (await response.json() as Array<{ query: string }>).some((item) => item.query === '느린 검색')
  }).toBe(true)

  await submitSearch(page, '카페')
  await expect(page.getByText('작업실 카페')).toBeVisible()
  await expect(page.getByText('조용한 라멘 연구소')).not.toBeVisible()
  await expect.poll(async () => {
    const response = await request.get(`${backendOrigin}/__test/search-observations`)
    const observations = await response.json() as Array<{ query: string; aborted: boolean }>
    return observations.findLast((item) => item.query === '느린 검색')?.aborted
  }).toBe(true)
})

test('renders partial, empty, error, and retry-safe states without private fields', async ({ page, request }) => {
  await page.goto('/search')
  await submitSearch(page, '부분 결과')
  await expect(page.getByText('일부 검색 소스의 결과가 지연되거나 누락되었습니다.')).toBeVisible()

  await submitSearch(page, '없음')
  await expect(page.getByText('조건에 맞는 장소가 없습니다.')).toBeVisible()

  await submitSearch(page, '오류')
  await expect(page.getByRole('alert').filter({ hasText: '검색 결과를 불러오지 못했습니다.' })).toBeVisible()
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible()

  const response = await request.post('/api/search/places', {
    data: { schemaVersion: 'place-search.v1', query: '카페' },
  })
  expect(response.status()).toBe(200)
  const body = JSON.stringify(await response.json())
  expect(body).not.toContain('membershipId')
  expect(body).not.toContain('personalRating')
  expect(body).not.toContain('PLACE_BACKEND_ORIGIN')
})

test('labels official provider results and lazily loads attributed details', async ({ page, request }) => {
  await page.goto('/search')
  await submitSearch(page, '공식 결과')

  const result = page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')
  await expect(result).toHaveCount(1)
  await expect(result).toContainText('Google Maps')
  if (await page.getByRole('button', { name: '목록', exact: true }).isVisible()) {
    await result.click()
  }
  await expect(page.getByRole('link', { name: 'Google Maps에서 열기' })).toHaveAttribute(
    'href', 'https://maps.example.invalid/place/100',
  )
  await expect(page.getByText('평점 4.6 · 120개 평가')).toBeVisible()
  await expect(page.getByLabel('정보 및 사진 출처')).toContainText('사진 작성자')

  const response = await request.post('/api/search/provider-details', {
    data: {
      schemaVersion: 'place-provider-detail.v1',
      providerKey: 'google', providerPlaceId: 'google-place-100',
    },
  })
  expect(response.status()).toBe(200)
  expect(JSON.stringify(await response.json())).not.toContain('apiKey')
})

test('reuses personal Place capabilities only for canonical search results', async ({ page }) => {
  let canonicalDetailRequests = 0
  let memberOverlayAvailable = false
  await page.route(/\/api\/places\/[^/?]+$/, async (route) => {
    canonicalDetailRequests += 1
    const selectedPlaceId = new URL(route.request().url()).pathname.split('/').at(-1)!
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'place-detail.v1',
        status: 'available',
        requestedPlaceId: selectedPlaceId,
        redirectedFrom: [],
        placeId: selectedPlaceId,
        name: '조용한 라멘 연구소',
        areaLabel: '성수',
        location: { latitude: 37.5445, longitude: 127.056 },
        primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
        taxonomyKeys: ['food.noodle.ramen'],
        evidence: { status: 'verified', projectedAt: '2026-08-29T00:00:00.000Z' },
        ...(memberOverlayAvailable
          ? {
              personalState: {
                saved: true,
                wanted: false,
                personalRating: 4.3,
                preferencesUpdatedAt: '2026-08-29T00:00:00.000Z',
                visits: { visited: false, count: 0 },
              },
            }
          : {}),
      }),
    })
  })
  await page.route('**/api/library/places/*/organization?*', async (route) => {
    const selectedPlaceId = new URL(route.request().url()).pathname.split('/').at(-2)!
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'library-place-organization.v1',
        placeId: selectedPlaceId,
        items: [],
      }),
    })
  })
  await page.route('**/api/places/*/visits?*', async (route) => {
    const selectedPlaceId = new URL(route.request().url()).pathname.split('/').at(-2)!
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'visit-history.v1',
        placeId: selectedPlaceId,
        items: [],
      }),
    })
  })
  await page.route('**/api/writing?*', async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'writing-list.v2',
        filter: { kind: 'note', placeId: url.searchParams.get('placeId') },
        items: [],
      }),
    })
  })

  await page.goto('/search')
  const results = page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')
  await expect(results).toHaveCount(3)
  await results.first().click()
  await expect(page.getByRole('link', { name: '로그인하고 계속' })).toBeVisible()

  memberOverlayAvailable = true
  if (await page.getByRole('button', { name: '목록으로' }).isVisible()) {
    await page.getByRole('button', { name: '목록으로' }).click()
  }
  await results.nth(1).click()

  await expect(page.getByRole('heading', { name: '내 상태' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '내 분류' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '방문 기록' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '내 메모' })).toBeVisible()
  const requestsAfterCanonicalSelection = canonicalDetailRequests
  expect(requestsAfterCanonicalSelection).toBeGreaterThan(0)

  await submitSearch(page, '공식 결과')
  if (await page.getByRole('button', { name: '목록', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '목록', exact: true }).click()
  }
  await expect(results).toHaveCount(1)
  await results.first().click()
  await expect(page.getByRole('link', { name: 'Google Maps에서 열기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '내 상태' })).not.toBeVisible()
  expect(canonicalDetailRequests).toBe(requestsAfterCanonicalSelection)
})

test('uses an independent detail pane and restores the selected mobile row', async ({ page }, testInfo) => {
  await page.goto('/search')
  const results = page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')
  await expect(results).toHaveCount(3)

  const selectedRow = results.nth(1)
  await selectedRow.click()
  await expect(page.getByRole('complementary', { name: '선택한 검색 결과 상세' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /긴 이름으로/ })).toBeVisible()

  if (testInfo.project.name === 'desktop-chromium') {
    await expect(page.getByRole('region', { name: '검색 결과 지도' })).toBeVisible()
    await page.getByRole('button', { name: '검색 결과 상세 닫기' }).click()
    await expect(page.getByRole('complementary', { name: '선택한 검색 결과 상세' })).not.toBeVisible()
    await expect(selectedRow).toHaveAttribute('aria-pressed', 'false')
  } else {
    await expect(page.getByRole('list', { name: '장소 검색 결과' })).not.toBeVisible()
    await page.getByRole('button', { name: '목록으로' }).click()
    await expect(page.getByRole('list', { name: '장소 검색 결과' })).toBeVisible()
    await expect(selectedRow).toBeFocused()
    await expect(selectedRow).toHaveAttribute('aria-pressed', 'true')
  }
})

test('captures the reviewed search workspace sizes', async ({ page }, testInfo) => {
  await page.goto('/search')
  await expect(page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')).toHaveCount(3)

  const visualFailures: unknown[] = []
  const capture = async (name: string, maxDiffPixelRatio?: number) => {
    try {
      await expect(page).toHaveScreenshot(name, {
        fullPage: true,
        ...(maxDiffPixelRatio === undefined ? {} : { maxDiffPixelRatio }),
      })
    } catch (error) {
      visualFailures.push(error)
    }
  }

  if (testInfo.project.name === 'desktop-chromium') {
    await expect(page.getByRole('alert').filter({
      hasText: '내 장소 기능을 불러오지 못했습니다.',
    })).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await capture('place-search-1440x900.png')
    await page.setViewportSize({ width: 1280, height: 800 })
    await capture('place-search-1280x800.png')

    await submitSearch(page, '부분 결과')
    await expect(page.getByText('일부 검색 소스의 결과가 지연되거나 누락되었습니다.')).toBeVisible()
    await capture('place-search-partial-1280x800.png', 0.01)

    await submitSearch(page, '느린 검색')
    await expect.poll(async () => page.getByText('검색 중…').isVisible()).toBe(true)
    await capture('place-search-loading-1280x800.png', 0.01)

    await submitSearch(page, '오류')
    await expect(page.getByRole('alert').filter({ hasText: '검색 결과를 불러오지 못했습니다.' })).toBeVisible()
    await capture('place-search-error-1280x800.png', 0.01)
  } else {
    await page.setViewportSize({ width: 390, height: 844 })
    await capture('place-search-390x844.png')
    await page.setViewportSize({ width: 360, height: 800 })
    await capture('place-search-360x800.png')

    await submitSearch(page, '없음')
    await expect(page.getByText('조건에 맞는 장소가 없습니다.')).toBeVisible()
    await capture('place-search-empty-360x800.png', 0.01)

    await submitSearch(page, '')
    await expect(page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')).toHaveCount(3)
    await page.getByRole('button', { name: '지도', exact: true }).click()
    await expect(page.getByRole('region', { name: '검색 결과 지도' })).toBeVisible()
    await capture('place-search-map-360x800.png')
  }

  if (visualFailures.length > 0) {
    throw new AggregateError(visualFailures, `${visualFailures.length} visual baselines differ`)
  }
})

test('suggests ambiguous places, cancels stale input, and records keyboard selection', async ({ page, request }) => {
  await page.goto('/search')
  const input = page.getByLabel('장소 검색어')
  await input.fill('센')
  await expect.poll(async () => {
    const response = await request.get(`${backendOrigin}/__test/suggestion-observations`)
    const body = await response.json() as { requests: Array<{ query: string }> }
    return body.requests.some((item) => item.query === '센')
  }).toBe(true)

  await input.fill('센카이')
  const options = page.getByRole('option', { name: /센카이 라멘/ })
  await expect(options).toHaveCount(2)
  await expect(options.nth(0)).toContainText('후쿠오카 하카타')
  await expect(options.nth(1)).toContainText('도쿄 신주쿠')

  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(input).toHaveValue('센카이 라멘')
  await expect.poll(async () => {
    const response = await request.get(`${backendOrigin}/__test/suggestion-observations`)
    const body = await response.json() as {
      requests: Array<{ query: string; aborted: boolean }>
      selections: Array<{ suggestionId: string }>
    }
    return {
      aborted: body.requests.findLast((item) => item.query === '센')?.aborted,
      selected: body.selections.at(-1)?.suggestionId,
    }
  }).toEqual({
    aborted: true,
    selected: '01992d20-6000-7000-8000-000000000003',
  })

  const response = await request.post('/api/search/suggestions', {
    data: { schemaVersion: 'place-suggestions.v1', query: 'senkai' },
  })
  expect(response.status()).toBe(200)
  const body = JSON.stringify(await response.json())
  expect(body).not.toMatch(/token|apiKey|cookie|profile/i)
  expect(body).not.toMatch(/membershipId|personalRating/i)

  await input.fill('부분 후보')
  await expect(page.getByRole('option', { name: /센카이 라멘/ })).toHaveCount(1)
  await expect(page.getByText('일부 출처의 후보가 지연되거나 누락됐습니다.')).toBeVisible()

  await input.fill('알 수 없는 오타')
  await expect(page.getByText('일치하는 후보가 없습니다. Enter로 전체 검색해 보세요.')).toBeVisible()
  await input.press('Enter')
  await expect(page.getByRole('list', { name: '장소 검색 결과' }).getByRole('button')).toHaveCount(3)
})

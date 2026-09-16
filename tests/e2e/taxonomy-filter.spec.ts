import { expect, test } from '@playwright/test'

const nodes = [
  { key: 'food', parentKey: null, label: '음식점', kind: 'category', version: 1 },
  { key: 'food.japanese', parentKey: 'food', label: '일식', kind: 'category', version: 1 },
  { key: 'food.noodle.ramen', parentKey: 'food.japanese', label: '라멘', kind: 'category', version: 1 },
  { key: 'food.noodle.ramen.shoyu', parentKey: 'food.noodle.ramen', label: '쇼유라멘', kind: 'category', version: 1 },
  ...Array.from({ length: 20 }, (_, index) => ({ key: `food.fixture${index}`, parentKey: 'food', label: `검증용 음식 분류 ${index + 1}`, kind: 'category', version: 1 })),
]

test('shows regional context and uses representative points without adding area-filter chips', async ({ page }) => {
  await page.route('**/api/v2/search/catalog/explore', (route) => {
    const query = route.request().postDataJSON().query
    const point = { kind: 'neighborhood', countryCode: 'KR', bounds: null, exact: true }
    return route.fulfill({ json: { schemaVersion: 'catalog-exploration.v2', intent: 'name', places: [], conditions: [], unrecognizedText: '',
      destinations: query === '경기도' ? [{ ...point, key: 'geonames:1841610', kind: 'administrative-area', name: '경기도',
        location: { latitude: 37.6, longitude: 127.25 } }] : query === '성수동' ? [
        { ...point, key: 'geonames:1836016', name: '성수동', contextLabel: '서울특별시 · 성동구', location: { latitude: 37.537, longitude: 127.0552 } },
        { ...point, key: 'geonames:11615486', name: '성수동', contextLabel: '전라남도', location: { latitude: 34.46081, longitude: 126.67678 } },
      ] : [],
    } })
  })
  await page.goto('/')
  const input = page.getByRole('combobox', { name: '곳곳간 카탈로그 검색', exact: true })
  await input.fill('경기도')
  await input.press('Enter')
  const map = page.getByRole('region', { name: '곳곳간 카탈로그 검색 지도' })
  await expect.poll(async () => Number(await map.getAttribute('data-place-map-zoom'))).toBe(8)
  await expect(page.locator('[class*="interpretation"] button')).toHaveCount(0)
  await input.fill('성수동')
  const seoul = page.getByRole('option').filter({ hasText: '서울특별시 · 성동구' })
  await expect(seoul).toBeVisible()
  await expect(page.getByRole('option').filter({ hasText: '전라남도' })).toBeVisible()
  await seoul.click()
  await expect.poll(async () => Number(await map.getAttribute('data-place-map-zoom'))).toBe(14)
  await expect(input).toHaveValue('성수동')
  await expect(page.locator('[class*="interpretation"] button')).toHaveCount(0)
})

test('browses bounded category options separately from entire-parent selection and can close by toggling', async ({ page }, testInfo) => {
  await page.route('**/api/search/taxonomy', (route) => route.fulfill({ json: { schemaVersion: 'place-taxonomy.v1', nodes } }))
  const widths = testInfo.project.name === 'desktop-chromium' ? [1440, 1280] : [390, 360]
  for (const width of widths) {
    await page.setViewportSize({ width, height: width > 720 ? 900 : 844 })
    await page.goto('/')
    const toggle = page.getByRole('button', { name: /^장소 유형/ })
    await toggle.click()
    const picker = page.getByRole('region', { name: '장소·음식 분류', exact: true })
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('button', { name: '음식점 전체 선택', exact: true })).toBeVisible()
    await expect(picker.getByRole('searchbox')).toBeHidden()
    await expect(page.getByRole('button', { name: '← 장소 검색으로' })).toHaveCount(0)
    await picker.getByRole('button', { name: '음식점 하위 분류 보기' }).click()
    await expect(picker.locator('li')).toHaveCount(12)
    await expect(picker.getByRole('button', { name: '음식점 전체 선택', exact: true })).toBeVisible()
    await picker.getByRole('button', { name: /분류 더 보기/ }).click()
    await expect(picker.locator('li')).toHaveCount(21)
    await picker.getByRole('button', { name: '일식 하위 분류 보기' }).click()
    await picker.getByRole('button', { name: '라멘 하위 분류 보기' }).click()
    const shoyu = picker.getByRole('button', { name: '쇼유라멘 선택', exact: true })
    await expect(shoyu).toBeInViewport()
    await expect(page.getByRole('banner')).toBeInViewport()
    await expect(page.getByText('지도를 불러오는 중입니다.', { exact: true })).toBeHidden()
    const mapBox = await page.getByRole('region', { name: '곳곳간 카탈로그 검색 지도' }).boundingBox()
    expect(mapBox?.height).toBeGreaterThanOrEqual(180)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`taxonomy-hierarchy-${width}.png`) })
    const searchRequest = page.waitForRequest((request) => request.url().endsWith('/api/v2/search/catalog'))
    await shoyu.click()
    expect((await searchRequest).postDataJSON()).toMatchObject({ taxonomyKey: 'food.noodle.ramen.shoyu', query: '' })
    await expect(picker).toBeHidden()
    await toggle.click()
    await expect(picker).toBeVisible()
    await picker.locator('summary').click()
    await picker.getByRole('searchbox').fill('쇼유라멘')
    await expect(picker.locator('li')).toHaveCount(1)
    await expect(picker.locator('li')).toContainText('음식점 › 일식 › 라멘')
    await toggle.click()
    await expect(picker).toBeHidden()
  }
})

test('distinguishes failed and empty taxonomy without inventing category choices', async ({ page }) => {
  let state: 'error' | 'empty' = 'error'
  await page.route('**/api/search/taxonomy', (route) => state === 'error'
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: { schemaVersion: 'place-taxonomy.v1', nodes: [] } }))
  await page.goto('/')
  await page.getByRole('button', { name: /^장소 유형/ }).click()
  const picker = page.getByRole('region', { name: '장소·음식 분류', exact: true })
  await expect(picker.getByRole('alert')).toContainText('분류를 불러오지 못했습니다.')
  state = 'empty'
  await picker.getByRole('button', { name: '다시 시도' }).click()
  await expect(picker).toContainText('세부 분류 준비 중')
  await expect(picker.locator('li')).toHaveCount(0)
  await picker.getByRole('button', { name: '검색어로 찾기', exact: true }).click()
  await expect(picker).toBeHidden()
})

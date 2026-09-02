import { expect, test } from '@playwright/test'

const configuredBaseUrl = process.env.PLACE_WEB_E2E_BASE_URL
if (configuredBaseUrl === undefined) throw new Error('PLACE_WEB_E2E_BASE_URL is required')
const webUrl = new URL(configuredBaseUrl)
const backendOrigin = `http://${webUrl.hostname}:${Number(webUrl.port) + 1}`

async function submitSearch(page: import('@playwright/test').Page, query: string) {
  const input = page.getByLabel('곳곳간 카탈로그 검색')
  await input.fill(query)
  await input.press('Enter')
}

test('searches only the canonical catalog and keeps list and map selection coordinated', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop catalog workspace coverage')

  await page.goto('/')
  await expect(page.getByText('지역과 장소 유형을 검색해 곳곳간의 통합 카탈로그를 탐색해 보세요.')).toBeVisible()
  await submitSearch(page, '성수 라멘')

  const results = page.locator('ol').getByRole('button')
  await expect(results).toHaveCount(2)
  await expect(results.nth(0)).toContainText('조용한 라멘 연구소')
  await expect(results.nth(1)).toContainText('성수 골목 쇼유라멘')
  await expect(page.getByRole('button', { name: /성수.*조건 제거/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /라멘.*조건 제거/ })).toBeVisible()

  await expect(results.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await results.nth(1).click()
  await expect(page.getByRole('button', { name: '성수 골목 쇼유라멘 지도에서 선택' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '선택한 장소', exact: true })).toContainText('성수 골목 쇼유라멘')

  await page.getByRole('button', { name: '조용한 라멘 연구소 지도에서 선택' }).click()
  await expect(results.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '선택한 장소', exact: true })).toContainText('조용한 라멘 연구소')

  await page.getByRole('button', { name: /성수.*조건 제거/ }).click()
  await expect(results).toHaveCount(3)
  await expect(page.getByRole('button', { name: /성수.*조건 제거/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /라멘.*조건 제거/ })).toBeVisible()
  await expect(page.getByText('강남 정통 라멘')).toBeVisible()

  await expect.poll(async () => {
    const response = await request.get(`${backendOrigin}/__test/catalog-search-observations`)
    const observations = await response.json() as Array<{ query: string; excludedTokenIds: string[] }>
    return observations.some((item) =>
      item.query === '성수 라멘' &&
      item.excludedTokenIds.includes('area:area.kr.seoul.seongdong.seongsu@1'))
  }).toBe(true)

  const apiResponse = await request.post('/api/search/catalog', {
    data: {
      schemaVersion: 'catalog-place-search.v1',
      query: '성수 라멘',
      excludedTokenIds: [],
      limit: 20,
    },
  })
  expect(apiResponse.status()).toBe(200)
  const apiBody = JSON.stringify(await apiResponse.json())
  expect(apiBody).not.toMatch(/providerPlaceId|Google Maps|NAVER|Kakao/)
  await expect(page.locator('body')).not.toContainText('Google Maps')
  await expect(page.locator('body')).not.toContainText('NAVER')
  await expect(page.locator('body')).not.toContainText('Kakao')
})

test('switches between the catalog list and map on mobile without losing selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile catalog workspace coverage')

  await page.goto('/')
  await submitSearch(page, '성수 라멘')
  const results = page.locator('ol').getByRole('button')
  await expect(results).toHaveCount(2)
  await results.nth(1).click()

  await expect(page.getByRole('button', { name: '지도', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '곳곳간 카탈로그 검색 지도' })).toBeVisible()
  await expect(page.getByRole('button', { name: '컬렉션 선택' })).toBeVisible()
  await expect(page.getByRole('region', { name: '선택한 장소', exact: true })).toContainText('성수 골목 쇼유라멘')
  await page.getByRole('button', { name: '조용한 라멘 연구소 지도에서 선택' }).click()

  await page.getByRole('button', { name: '목록', exact: true }).click()
  await expect(results.nth(0)).toBeVisible()
  await expect(results.nth(0)).toHaveAttribute('aria-pressed', 'true')
})

test('redirects the retired search workspace to Home', async ({ page }) => {
  await page.goto('/search')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByLabel('곳곳간 카탈로그 검색')).toBeVisible()
  await expect(page.getByText('장소 찾기', { exact: true })).toHaveCount(0)
})

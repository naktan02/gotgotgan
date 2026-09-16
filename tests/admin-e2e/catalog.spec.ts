import { expect, test } from '@playwright/test'

const placeId = '01992d20-0000-7000-8000-000000000001'
const row = { placeId, name: '회귀 테스트 카페', area: null, location: null,
  primaryTaxonomy: null, taxonomyReferences: [], evidenceStatus: 'unverified', projectedAt: '2026-09-05T00:00:00.000Z' }
const pageResult = (items = [row], nextCursor?: string) => ({ schemaVersion: 'catalog-place-search.v1',
  interpretation: { normalizedQuery: '카페', tokens: [] }, items, mapBounds: null,
  ...(nextCursor === undefined ? {} : { nextCursor }) })

test('Admin catalog search, paging, public detail and denied access', async ({ page }, testInfo) => {
  await page.route('**/api/admin/session', (route) => route.fulfill({ json: {
    schemaVersion: 'place-admin-session.v1', authorityRole: 'reviewer', userGrade: 'standard', productTier: 'basic',
  } }))
  const queries: unknown[] = []
  await page.route('**/api/admin/catalog', (route) => {
    const input = route.request().postDataJSON()
    queries.push(input)
    return route.fulfill({ json: input.cursor ? pageResult([]) : pageResult([row], 'next') })
  })
  await page.route(`**/api/admin/catalog/${placeId}`, (route) => route.fulfill({ json: {
    schemaVersion: 'place-detail.v1', requestedPlaceId: placeId, placeId, redirectedFrom: [], status: 'available',
    name: row.name, areaLabel: '테스트 지역', location: { latitude: 37, longitude: 127 },
    primaryTaxonomy: null, taxonomyKeys: [], evidence: { status: 'unverified', projectedAt: row.projectedAt },
  } }))
  await page.goto('/catalog')
  await expect(page.getByRole('region', { name: '장소 데이터 조회' })).toBeVisible()
  if (testInfo.project.name === 'admin-mobile') {
    const toggle = page.getByRole('button', { name: '메뉴', exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toBeHidden()
  } else {
    await page.getByRole('button', { name: '관리자 메뉴 접기' }).click()
    await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toBeHidden()
    await page.getByRole('button', { name: '관리자 메뉴 펼치기' }).click()
    await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toBeVisible()
  }
  await page.getByRole('textbox', { name: '장소·지역·분류 검색' }).fill('카페')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await page.getByRole('button', { name: /회귀 테스트 카페/ }).click()
  await expect(page.getByRole('region', { name: '선택한 장소 상세' }).getByText('테스트 지역')).toBeVisible()
  await page.getByRole('button', { name: '더 보기' }).click()
  await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0)
  expect(queries).toHaveLength(2)
  expect(queries[1]).toMatchObject({ query: '카페', cursor: 'next' })
  await expect(page.getByRole('link', { name: '장소 데이터', exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page')
  await page.screenshot({ path: testInfo.outputPath('catalog.png'), fullPage: true })
  await page.unroute('**/api/admin/session')
  await page.route('**/api/admin/session', (route) => route.fulfill({ status: 403, json: {} }))
  await page.reload()
  await expect(page.getByText('이 계정은 관리자 앱을 사용할 수 없습니다')).toBeVisible()
  await expect(page.getByRole('region', { name: '장소 데이터 조회' })).toHaveCount(0)
})

test('Admin catalog reports empty and error states without fabricated data', async ({ page }) => {
  await page.route('**/api/admin/session', (route) => route.fulfill({ json: {
    schemaVersion: 'place-admin-session.v1', authorityRole: 'owner', userGrade: 'standard', productTier: 'basic',
  } }))
  await page.route('**/api/admin/catalog', (route) => route.fulfill({ json: pageResult([]) }))
  await page.goto('/catalog')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByText('조건에 맞는 공개 장소가 없습니다.')).toBeVisible()
  await page.unroute('**/api/admin/catalog')
  await page.route('**/api/admin/catalog', (route) => route.fulfill({ status: 503, json: {} }))
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('region', { name: '검색 결과' }).getByRole('alert')).toContainText('조회에 실패했습니다.')
})

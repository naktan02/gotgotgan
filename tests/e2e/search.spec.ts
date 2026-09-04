import { expect, test } from '@playwright/test'
import type { PlaceFilingCommandRequestV2 } from '@place/contracts/library'

const configuredBaseUrl = process.env.PLACE_WEB_E2E_BASE_URL
if (configuredBaseUrl === undefined) throw new Error('PLACE_WEB_E2E_BASE_URL is required')
const webUrl = new URL(configuredBaseUrl)
const backendOrigin = `http://${webUrl.hostname}:${Number(webUrl.port) + 1}`

async function submitSearch(page: import('@playwright/test').Page, query: string) {
  const input = page.getByRole('textbox', {
    name: '곳곳간 카탈로그 검색',
    exact: true,
  })
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
  await expect(page.getByRole('link', { name: 'Google Maps로 길찾기' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'NAVER로 길찾기' })).toBeVisible()
  await expect(page.getByRole('link', { name: '카카오맵으로 길찾기' })).toBeVisible()
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

test('uses the local MapLibre style and expands a server cluster into accessible markers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop MapLibre projection coverage')
  const unexpectedExternalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname !== webUrl.hostname || url.port !== webUrl.port)) {
      unexpectedExternalRequests.push(request.url())
    }
  })

  await page.goto('/')
  const style = await page.request.get('/api/maps/style')
  expect(style.status()).toBe(200)
  expect((await style.json()).sources).toEqual({})
  await submitSearch(page, '성수 라멘')
  await expect(page.getByRole('button', { name: '조용한 라멘 연구소 지도에서 선택' })).toBeVisible()

  const zoomOut = page.locator('.maplibregl-ctrl-zoom-out')
  await zoomOut.click()
  const mapRegion = page.getByRole('region', { name: '곳곳간 카탈로그 검색 지도' })
  await expect.poll(async () => Number(await mapRegion.getAttribute('data-place-map-zoom'))).toBeLessThan(12)
  await page.getByRole('button', { name: '이 지역에서 보기' }).click()
  const cluster = page.getByRole('button', { name: '2개 장소 묶음 확대' })
  await expect(cluster).toBeVisible()
  await cluster.click()
  await expect(page.getByRole('button', { name: '성수 골목 쇼유라멘 지도에서 선택' })).toBeVisible()
  expect(unexpectedExternalRequests).toEqual([])
})

test('redirects the retired search workspace to Home', async ({ page }) => {
  await page.goto('/search')
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole('textbox', { name: '곳곳간 카탈로그 검색', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('장소 찾기', { exact: true })).toHaveCount(0)
})

test('files a Home search result into multiple Collections with one v2 command', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop Home filing coverage')
  const ramenCollectionId = '01992d20-7000-7000-8000-000000000301'
  const tripCollectionId = '01992d20-7000-7000-8000-000000000302'
  const commands: PlaceFilingCommandRequestV2[] = []
  const collection = (collectionId: string, name: string) => ({
    collectionId,
    name,
    description: null,
    visibility: 'private',
    publicationId: null,
    placeCount: 0,
    collectionRevision: `revision.${collectionId}`,
    updatedAt: '2026-09-03T00:00:00.000Z',
  })
  await page.route('**/api/library/workspace?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'any' },
        tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      },
      collections: [
        collection(ramenCollectionId, '서울 라멘'),
        collection(tripCollectionId, '주말 여행'),
      ],
      places: [],
      availableFilters: {
        coverage: {
          favoritePlaceCount: 0, sampledPlaceCount: 0,
          projectedPlaceCount: 0, complete: true,
        },
        areas: [], taxonomies: [],
      },
    }),
  }))
  await page.route('**/api/library/places/*/filing?*', (route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').at(-2)!
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'place-filing.v2',
        placeId,
        overlay: { isFavorited: false, collectionCount: 0, personalRating: null },
        collections: [
          { collectionId: ramenCollectionId, name: '서울 라멘', included: false, collectionRevision: `revision.${ramenCollectionId}` },
          { collectionId: tripCollectionId, name: '주말 여행', included: false, collectionRevision: `revision.${tripCollectionId}` },
        ],
      }),
    })
  })
  await page.route('**/api/library/filing-commands', async (route) => {
    const command = route.request().postDataJSON() as PlaceFilingCommandRequestV2
    commands.push(command)
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'place-filing-command-result.v2',
        outcome: 'accepted',
        receipt: { commandId: command.commandId, status: 'applied' },
        placeId: command.placeId,
        overlay: { isFavorited: true, collectionCount: 2, personalRating: null },
        collections: command.changes.map((change) => ({
          collectionId: change.collectionId,
          included: true,
          collectionRevision: `${change.expectedCollectionRevision}.next`,
        })),
      }),
    })
  })

  await page.goto('/')
  await submitSearch(page, '성수 라멘')
  await page.getByRole('button', { name: '컬렉션 선택' }).click()
  const filing = page.getByRole('region', { name: '내 카테고리' })
  await filing.getByLabel(/서울 라멘/).check()
  await filing.getByLabel(/주말 여행/).check()
  await filing.getByRole('button', { name: '변경 저장' }).click()
  await expect(filing.getByRole('status').filter({ hasText: '내 카테고리를 저장했습니다.' })).toBeVisible()

  expect(commands).toHaveLength(1)
  expect(commands[0]?.schemaVersion).toBe('place-filing-command.v2')
  expect(commands[0]?.changes).toHaveLength(2)
})

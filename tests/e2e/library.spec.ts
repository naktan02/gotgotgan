import { expect, test, type Page, type Route } from '@playwright/test'

const ramenPlaceId = '01992d20-7000-7000-8000-000000000101'
const cafePlaceId = '01992d20-7000-7000-8000-000000000102'
const ramenTagId = '01992d20-7000-7000-8000-000000000201'
const shoyuTagId = '01992d20-7000-7000-8000-000000000202'
const seongsuCollectionId = '01992d20-7000-7000-8000-000000000301'
const timestamp = '2026-08-28T00:00:00.000Z'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function place(placeId: string, name: string, areaLabel: string, taxonomy: string) {
  return {
    placeId,
    name,
    areaLabel,
    location: placeId === ramenPlaceId
      ? { latitude: 37.5447, longitude: 127.0557 }
      : { latitude: 37.5461, longitude: 127.0492 },
    primaryTaxonomy: { key: taxonomy.toLowerCase(), label: taxonomy },
    taxonomyKeys: [taxonomy.toLowerCase()],
    evidence: { status: 'verified', projectedAt: timestamp },
  }
}

const ramen = place(ramenPlaceId, '멘야 하루', '서울 성동구 성수동', '쇼유라멘')
const cafe = place(cafePlaceId, '서울숲 로스터스', '서울 성동구 성수동', '카페')

async function installLibraryFixture(page: Page) {
  await page.route('**/api/library/tags?*', (route) => json(route, {
    schemaVersion: 'library-tag-list.v1',
    items: [
      { tagId: ramenTagId, name: '라면', placeCount: 1, createdAt: timestamp },
      { tagId: shoyuTagId, name: '쇼유라멘', placeCount: 1, createdAt: timestamp },
    ],
  }))
  await page.route('**/api/library/collections?*', (route) => json(route, {
    schemaVersion: 'library-collection-list.v1',
    items: [{
      collectionId: seongsuCollectionId,
      name: '성수동',
      description: '성수동에서 다시 가볼 곳',
      visibility: 'private',
      publicationId: null,
      placeCount: 2,
      updatedAt: timestamp,
    }],
  }))
  await page.route(`**/api/library/collections/${seongsuCollectionId}?*`, (route) => json(route, {
    schemaVersion: 'library-collection-detail.v1',
    collection: {
      collectionId: seongsuCollectionId,
      name: '성수동',
      description: '성수동에서 다시 가볼 곳',
      visibility: 'private',
      publicationId: null,
      placeCount: 2,
      updatedAt: timestamp,
    },
    places: [
      { placeId: ramenPlaceId, position: 0, addedAt: timestamp, place: ramen },
      { placeId: cafePlaceId, position: 1, addedAt: timestamp, place: cafe },
    ],
  }))
  await page.route('**/api/library/places?*', (route) => {
    const url = new URL(route.request().url())
    const selectedTags = url.searchParams.getAll('tagIds')
    const items = selectedTags.length === 0 || selectedTags.includes(ramenTagId)
      ? [{
          placeId: ramenPlaceId,
          saved: true,
          wanted: url.searchParams.get('state') === 'wanted',
          personalRating: 4.5,
          updatedAt: timestamp,
          place: ramen,
        }, {
          placeId: cafePlaceId,
          saved: true,
          wanted: false,
          personalRating: null,
          updatedAt: timestamp,
          place: cafe,
        }].slice(0, selectedTags.length === 0 ? 2 : 1)
      : []
    return json(route, {
      schemaVersion: 'library-place-list.v2',
      filter: {
        state: url.searchParams.get('state') ?? 'saved',
        tagIds: [...selectedTags].sort(),
        tagMatch: url.searchParams.get('tagMatch') ?? 'all',
      },
      items,
    })
  })
  await page.route('**/api/places/*', (route) => {
    const selected = route.request().url().includes(ramenPlaceId) ? ramen : cafe
    return json(route, {
      schemaVersion: 'place-detail.v1',
      status: 'available',
      requestedPlaceId: selected.placeId,
      redirectedFrom: [],
      ...selected,
      personalState: {
        saved: true,
        wanted: false,
        personalRating: selected.placeId === ramenPlaceId ? 4.5 : null,
        preferencesUpdatedAt: timestamp,
        visits: selected.placeId === ramenPlaceId
          ? { visited: true, count: 2, firstVisitedAt: timestamp, lastVisitedAt: timestamp }
          : { visited: false, count: 0 },
      },
    })
  })
}

test('browses saved Places by tags and Collection without leaking the Backend boundary', async ({ page }) => {
  await installLibraryFixture(page)
  await page.goto('/library')

  await expect(page.getByRole('heading', { name: '내 장소' })).toBeVisible()
  await expect(page.getByRole('link', { name: '내 장소' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: /라면/ })).toBeVisible()
  await expect(page.getByText('멘야 하루', { exact: true }).first()).toBeVisible()
  await expect(page.locator('dl').getByText('4.5', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /^라면/ }).click()
  await expect(page.getByRole('button', { name: /^라면/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('서울숲 로스터스', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: /^쇼유라멘/ }).click()
  await page.getByRole('button', { name: '하나 이상' }).click()
  await expect(page.getByRole('button', { name: '하나 이상' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '성수동 2' }).click()
  await expect(page.getByText('서울숲 로스터스', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '성수동 2' })).toHaveAttribute('aria-current', 'page')
})

test('shows a login action when the opaque browser session is absent', async ({ page }) => {
  await page.route('**/api/library/**', (route) => json(route, {
    type: 'urn:place:error:authentication-required',
    title: 'Authentication required',
    status: 401,
    code: 'PLACE_AUTHENTICATION_REQUIRED',
    retryable: false,
    correlationRef: 'e2e-auth-required',
  }, 401))

  await page.goto('/library')

  await expect(page.getByRole('heading', { name: '내 장소를 보려면 로그인이 필요합니다.' })).toBeVisible()
  await expect(page.getByRole('link', { name: '로그인하고 계속' })).toHaveAttribute('href', '/api/auth/oidc/start')
})

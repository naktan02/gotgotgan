import { expect, test, type Page } from '@playwright/test'

const publicationId = '01992d20-0000-7000-8000-000000000061'
const placeId = '01992d20-0000-7000-8000-000000000062'
const at = '2026-09-03T00:00:00.000Z'
const place = {
  placeId,
  position: 0,
  place: {
    placeId,
    name: '도쿄 국립과학박물관',
    areaLabel: '도쿄 · 우에노',
    location: { latitude: 35.7166, longitude: 139.7761 },
    primaryTaxonomy: { key: 'culture.museum', label: '박물관' },
    taxonomyKeys: ['culture.museum'],
    evidence: { status: 'verified', projectedAt: at },
  },
}

async function routeDiscovery(page: Page) {
  await page.route('**/api/public/collection-directory?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 'public-collection-directory.v2',
      filter: { q: null, areaKeys: [], taxonomyKeys: [], topicKeys: [], sort: 'recent' },
      items: [{
        publicationId, publicationVersion: 'collection-revision.v1.source',
        name: '도쿄 현지인이 추천하는 실내 가족 코스',
        description: '비 오는 날에도 아이와 함께 즐길 수 있는 도쿄 실내 명소예요.',
        placeCount: 1, updatedAt: at,
        owner: { handle: 'tokyo-curator', displayName: '도쿄새댁 유미' },
        topics: [{ key: 'family', label: '아이와 함께' }], previewPlaces: [place],
      }],
      availableFilters: {
        areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '도쿄', count: 1 }],
        taxonomies: [{ key: 'culture.museum', label: '박물관', count: 1 }],
        topics: [{ key: 'family', label: '아이와 함께', count: 1 }],
      },
    }),
  }))
  await page.route(`**/api/public/discoverable-collections/${publicationId}?**`, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 'discoverable-collection.v2', publicationId,
      publicationVersion: 'collection-revision.v1.source',
      name: '도쿄 현지인이 추천하는 실내 가족 코스',
      description: '비 오는 날에도 아이와 함께 즐길 수 있는 도쿄 실내 명소예요.',
      placeCount: 1, updatedAt: at,
      owner: { handle: 'tokyo-curator', displayName: '도쿄새댁 유미' },
      topics: [{ key: 'family', label: '아이와 함께' }], places: [place],
    }),
  }))
}

test('discovers a public list and copies only explicitly selected Places through v2', async ({ page }) => {
  await routeDiscovery(page)
  const copyCommands: unknown[] = []
  await page.route('**/api/library/publication-copy-commands', async (route) => {
    const command = route.request().postDataJSON()
    copyCommands.push(command)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'published-collection-copy-command-result.v2',
        outcome: 'accepted',
        receipt: { commandId: command.commandId, status: 'applied' },
        collectionId: command.target.collectionId,
        collectionRevision: 'collection-revision.v1.target', copiedPlaceCount: 1,
      }),
    })
  })

  await page.goto('/browse')
  await expect(page.getByRole('heading', { name: '둘러보기' })).toBeVisible()
  await expect(page.getByLabel('공개 범위 필터')).toHaveValue('public')
  await expect(page.getByRole('heading', { name: '도쿄 현지인이 추천하는 실내 가족 코스' }).last()).toBeVisible()
  await expect(page.getByText('개인 메모, 방문 기록, 개인 사진과 평점은 공개되거나 복사되지 않습니다')).toBeVisible()

  await page.getByLabel('도쿄 국립과학박물관 일부 복사 선택').check()
  await page.getByRole('button', { name: '일부 복사 (1)' }).click()
  await expect(page.getByRole('link', { name: '복사한 목록 보기' })).toHaveAttribute('href', /\/library\?collection=/)
  expect(copyCommands).toHaveLength(1)
  expect(copyCommands[0]).toMatchObject({
    schemaVersion: 'published-collection-copy-command.v2',
    sourcePublicationId: publicationId,
    expectedPublicationVersion: 'collection-revision.v1.source',
    selection: { kind: 'places', placeIds: [placeId] },
  })
  expect(copyCommands[0]).not.toHaveProperty('memberId')
})

test('keeps discovery and selected detail usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await routeDiscovery(page)
  await page.goto('/browse')

  await expect(page.getByLabel('공개 목록 검색')).toBeVisible()
  await expect(page.getByRole('button', { name: /도쿄 현지인이 추천하는 실내 가족 코스/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '도쿄 현지인이 추천하는 실내 가족 코스 지도 미리보기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '전체 복사' })).toBeVisible()
})

import { expect, test, type Page } from '@playwright/test'

const connectionId = '01992d20-0000-7000-8000-000000000071'
const collectionId = '01992d20-0000-7000-8000-000000000072'
const placeId = '01992d20-0000-7000-8000-000000000073'

async function routeSettings(page: Page, verifiedFakeAdapter = false) {
  await page.route('**/api/v2/transfers/provider-capabilities', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'provider-capability-list.v2',
      items: ['naver', 'google', 'kakao'].map((providerKey) => ({
        providerKey, displayName: providerKey === 'naver' ? 'NAVER' : providerKey === 'google' ? 'Google' : 'Kakao',
        connections: { availability: verifiedFakeAdapter && providerKey === 'naver' ? 'available' : providerKey === 'naver' ? 'integration-gated' : 'unavailable', multipleAccounts: true, authMethods: verifiedFakeAdapter && providerKey === 'naver' ? ['oauth'] : [] },
        importSavedPlaces: verifiedFakeAdapter && providerKey === 'naver' ? { availability: 'available' } : providerKey === 'naver' ? { availability: 'integration-gated' } : { availability: 'unavailable', reason: 'source-adapter-unavailable' },
        exportCollections: verifiedFakeAdapter && providerKey === 'naver' ? { availability: 'available' } : { availability: 'unavailable', reason: 'target-adapter-unavailable' },
      })),
    }),
  }))
  await page.route('**/api/v2/transfers/provider-connections', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'provider-connection-list.v2', items: verifiedFakeAdapter ? [{
        schemaVersion: 'provider-connection.v2', connectionId, providerKey: 'naver', label: '여행 계정',
        authMethod: 'oauth', state: 'ready', connectionRevision: 'connection-r1', lastVerifiedAt: '2026-09-03T00:00:00.000Z',
        actionRequired: null, createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
      }] : [],
    }),
  }))
  await page.route('**/api/library/workspace?**', (route) => {
    const scoped = new URL(route.request().url()).searchParams.has('collectionId')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'personal-library-workspace.v2',
      filter: { favoriteScope: scoped ? { kind: 'collection', collectionId } : { kind: 'all' }, ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
      collections: [{ collectionId, name: '도쿄 여행', description: null, visibility: 'private', publicationId: null, placeCount: 1, collectionRevision: 'collection-r1', updatedAt: '2026-09-03T00:00:00.000Z' }],
      places: scoped ? [{ placeId, overlay: { isFavorited: true, collectionCount: 1, personalRating: null }, place: {
        placeId, name: '센소지', areaLabel: '도쿄 · 아사쿠사', location: { latitude: 35.7148, longitude: 139.7967 },
        primaryTaxonomy: { key: 'culture.temple', label: '사찰' }, taxonomyKeys: ['culture.temple'],
        evidence: { status: 'verified', projectedAt: '2026-09-03T00:00:00.000Z' },
      } }] : [],
      availableFilters: { coverage: { favoritePlaceCount: 1, sampledPlaceCount: scoped ? 1 : 0, projectedPlaceCount: scoped ? 1 : 0, complete: true }, areas: [], taxonomies: [] },
    }) })
  })
  await page.route(`**/api/v2/transfers/provider-connections/${connectionId}/target-lists`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'provider-target-list-projection.v2', connectionId, availability: 'available', reason: null,
      targetObservationRevision: 'target-r1', items: [{ targetListId: 'remote-list', name: '기존 도쿄', itemCount: 4 }],
    }),
  }))
}

test('shows provider connections independently and preserves the settings shell', async ({ page }, testInfo) => {
  await routeSettings(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '설정' })).toBeVisible()
  await expect(page.getByText('연결된 계정 없음').first()).toBeVisible()
  await expect(page.getByText('계정 연결은 운영 연동이 활성화된 뒤 사용할 수 있습니다').first()).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '메뉴 열기' }).click()
  }
  await expect(page.getByRole('navigation', { name: '패밀리 서비스' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '작업 내역' })).toBeVisible()
})

test('verified fake adapter composition sends only explicitly selected places in an export preview', async ({ page }) => {
  await routeSettings(page, true)
  const commands: unknown[] = []
  await page.route('**/api/v2/transfers/outbound-transfer-commands', async (route) => {
    const command = route.request().postDataJSON()
    commands.push(command)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'outbound-transfer-command-result.v2', outcome: 'accepted', commandId: command.commandId, status: 'applied',
      transfer: {
        schemaVersion: 'outbound-transfer.v2', transferId: command.transferId, transferRevision: 'transfer-r1',
        providerKey: 'naver', connectionId, collectionId, collectionRevision: 'collection-r1', target: command.target,
        targetObservationRevision: 'target-r1', planDigest: 'a'.repeat(64), state: 'draft', selection: command.selection,
        itemCount: 1, preview: { availability: 'available', addCount: 1, alreadyPresentCount: 0, unresolvedCount: 0, unsupportedCount: 0, items: [{ placeId, status: 'add' }] },
        approval: { eligible: true, reason: null }, approvalReceipt: null,
        createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
      },
    }) })
  })
  await page.goto('/settings?tab=export')
  await page.getByLabel('장소 범위').selectOption('places')
  await page.getByText('센소지').click()
  await page.getByRole('button', { name: '변경 미리보기' }).click()
  await expect(page.getByRole('button', { name: '이 변경으로 내보내기 승인' })).toBeEnabled()
  expect(commands).toHaveLength(1)
  expect(commands[0]).toMatchObject({ selection: { kind: 'places', placeIds: [placeId] } })
})

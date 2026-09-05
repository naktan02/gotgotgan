import { expect, test, type Page } from '@playwright/test'

const connectionId = '01992d20-0000-7000-8000-000000000071'
const collectionId = '01992d20-0000-7000-8000-000000000072'
const placeId = '01992d20-0000-7000-8000-000000000073'
type StartAcquisitionCommand = Readonly<{
  commandId: string
  kind: 'shared-links' | 'remote-browser'
  acquisitionId: string
  importSourceId: string
  snapshotId?: string
  links?: readonly Readonly<{ entryId: string; position: number; url: string }>[]
}>

function acquisition(command: StartAcquisitionCommand) {
  if (command.kind === 'remote-browser') return {
    schemaVersion: 'import-acquisition.v1', acquisitionId: command.acquisitionId,
    acquisitionRevision: 'remote-r1', importSourceId: command.importSourceId,
    providerKey: 'naver', method: 'remote-browser', state: 'failed', items: [],
    progress: { total: 0, processed: 0, ready: 0, failed: 0 },
    interaction: { state: 'integration-gated' },
    createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:02:00.000Z',
  }
  const links = command.links ?? []
  return {
    schemaVersion: 'import-acquisition.v1', acquisitionId: command.acquisitionId,
    acquisitionRevision: 'shared-r1', importSourceId: command.importSourceId,
    providerKey: 'naver', method: 'shared-links', state: 'partial',
    items: [
      { entryId: links[0]?.entryId, position: 0, state: 'ready', sourceListId: 'naver-list-1', name: '주말에 갈 곳', itemCount: 24 },
      { entryId: links[1]?.entryId, position: 1, state: 'ready', sourceListId: 'naver-list-2', name: '서울 커피', itemCount: 11 },
      { entryId: links[2]?.entryId, position: 2, state: 'duplicate', duplicateOfEntryId: links[0]?.entryId },
      { entryId: links[3]?.entryId, position: 3, state: 'unavailable', failure: { code: 'share-not-readable', retryable: false } },
    ],
    progress: { total: 4, processed: 4, ready: 2, failed: 2 },
    snapshot: { snapshotId: command.snapshotId, snapshotVersion: 'snapshot-r1' },
    createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:02.000Z',
  }
}

function singleReadyAcquisition(command: StartAcquisitionCommand, name: string) {
  const entryId = command.links?.[0]?.entryId
  return {
    schemaVersion: 'import-acquisition.v1', acquisitionId: command.acquisitionId,
    acquisitionRevision: 'shared-r1', importSourceId: command.importSourceId,
    providerKey: 'naver', method: 'shared-links', state: 'ready',
    items: [{ entryId, position: 0, state: 'ready', sourceListId: `list-${command.acquisitionId}`, name, itemCount: 1 }],
    progress: { total: 1, processed: 1, ready: 1, failed: 0 },
    snapshot: { snapshotId: command.snapshotId, snapshotVersion: 'snapshot-r1' },
    createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:02.000Z',
  }
}

function largeReviewPlan(planId: string, snapshotId: string, revision: string, skippedItemId?: string) {
  const items = Array.from({ length: 151 }, (_, index) => {
    const sourceItemId = `review-item-${index + 1}`
    const skipped = sourceItemId === skippedItemId
    return {
      sourceItemId, providerPlaceId: null, observedName: `검토 장소 ${index + 1}`,
      observedAddress: null, placeId: null,
      status: skipped ? 'skipped' : 'unresolved',
      decision: skipped ? 'skip' : 'none', providerDetailStatus: null,
    }
  })
  const skippedCount = skippedItemId === undefined ? 0 : 1
  return {
    schemaVersion: 'import-plan.v4', planId, planRevision: revision,
    snapshotId, snapshotVersion: 'snapshot-r1', providerKey: 'naver',
    source: {
      kind: 'one-shot', importSourceId: '01992d20-0000-7000-8000-000000000099',
      acquisitionMethod: 'shared-link', authorizationBasis: 'link-possession', accountAssurance: 'unverified',
    },
    state: 'draft', approval: { eligible: false, reason: 'unresolved-places' },
    mappings: [{
      sourceListId: 'naver-list-1', observedName: '대량 검토 목록', sourcePosition: 0,
      target: { kind: 'new', collectionId, name: '대량 검토 목록' },
      itemCount: 151, unresolvedItemCount: 151 - skippedCount,
      preview: {
        addCount: 0, alreadyPresentCount: 0,
        unresolvedCount: 151 - skippedCount, skippedCount, items,
      },
      materialization: { state: 'pending', collectionRevision: null, rejectionCode: null },
    }],
    createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:01:00.000Z',
  }
}

async function routeSettings(page: Page, verifiedFakeAdapter = false) {
  await page.route('**/api/v2/transfers/provider-capabilities', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'provider-capability-list.v2',
      items: ['naver', 'google', 'kakao'].map((providerKey) => ({
        providerKey, displayName: providerKey === 'naver' ? 'NAVER' : providerKey === 'google' ? 'Google' : 'Kakao',
        connections: { availability: verifiedFakeAdapter && providerKey === 'naver' ? 'available' : providerKey === 'naver' ? 'integration-gated' : 'unavailable', multipleAccounts: true, authMethods: verifiedFakeAdapter && providerKey === 'naver' ? ['oauth'] : [] },
        importSavedPlaces: verifiedFakeAdapter && providerKey === 'naver'
          ? { availability: 'available' }
          : providerKey === 'naver'
            ? { availability: 'integration-gated', reason: 'source-adapter-unavailable' }
            : { availability: 'unavailable', reason: 'source-adapter-unavailable' },
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

async function routeImportAcquisition(page: Page) {
  let latestShared: StartAcquisitionCommand | undefined
  await page.route('**/api/v1/transfers/import-acquisitions', async (route) => {
    const command = route.request().postDataJSON() as StartAcquisitionCommand
    if (command.kind === 'shared-links') latestShared = command
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
        commandId: command.commandId, status: 'applied', acquisition: acquisition(command),
      }),
    })
  })
  await page.route('**/api/v1/transfers/import-acquisitions/*', async (route) => {
    if (latestShared === undefined) return route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(acquisition(latestShared)) })
  })
  await page.route('**/api/v3/transfers/source-snapshots/*', async (route) => {
    if (latestShared === undefined) return route.abort()
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'source-snapshot-detail.v3', snapshotId: latestShared.snapshotId,
      snapshotVersion: 'snapshot-r1', providerKey: 'naver', sourceRevision: 'shared-source-r1',
      source: { kind: 'one-shot', importSourceId: latestShared.importSourceId, acquisitionMethod: 'shared-link', authorizationBasis: 'link-possession', accountAssurance: 'unverified' },
      listCount: 2, itemCount: 35, unresolvedItemCount: 2,
      observedAt: '2026-09-05T08:03:00.000Z', capturedAt: '2026-09-05T08:04:00.000Z',
      lists: [
        { sourceListId: 'naver-list-1', observedName: '주말에 갈 곳', sourcePosition: 0, itemCount: 24, unresolvedItemCount: 2, items: [] },
        { sourceListId: 'naver-list-2', observedName: '서울 커피', sourcePosition: 1, itemCount: 11, unresolvedItemCount: 0, items: [] },
      ],
    }) })
  })
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
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('banner').getByRole('button', { name: '메뉴 닫기' }).click()
  }

  const connectionsTab = page.getByRole('tab', { name: '외부 서비스 연결' })
  await connectionsTab.focus()
  await connectionsTab.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '데이터 가져오기' })).toBeFocused()
  await expect(page.getByRole('tab', { name: '데이터 가져오기' })).toHaveAttribute('aria-selected', 'true')
})

test('reviews a partial batch of NAVER shared links on desktop and mobile', async ({ page }, testInfo) => {
  await routeSettings(page)
  await routeImportAcquisition(page)
  await page.goto('/settings?tab=import')

  await page.getByLabel('NAVER 공유 링크').fill([
    'https://naver.me/weekend',
    'https://naver.me/coffee',
    'https://naver.me/weekend-copy',
    'https://naver.me/private',
  ].join('\n'))
  await page.getByRole('button', { name: '링크 4개 확인' }).click()

  await expect(page.getByText('주말에 갈 곳', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('서울 커피', { exact: true })).toBeVisible()
  await expect(page.getByText('중복 링크')).toBeVisible()
  await expect(page.getByText('공유 해제 또는 찾을 수 없음')).toBeVisible()
  await expect(page.getByRole('button', { name: '선택한 2개 목록 검토' })).toBeEnabled()
  await page.getByText('중복 링크').scrollIntoViewIfNeeded()
  await expect(page).toHaveScreenshot('place-import-acquisition-shared-links.png', { animations: 'disabled' })
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(page).toHaveScreenshot('place-import-acquisition-shared-links-compact.png', { animations: 'disabled' })
  }

  await page.reload()
  await expect(page.getByText('주말에 갈 곳', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '선택한 2개 목록 검토' })).toBeEnabled()

  await page.getByRole('button', { name: '선택한 2개 목록 검토' }).click()
  await expect(page.getByRole('heading', { name: '외부 목록과 목적지' })).toBeVisible()
  await expect(page.getByRole('button', { name: '매칭 미리보기' })).toBeEnabled()
  if (testInfo.project.name === 'desktop-chromium') {
    await page.getByRole('heading', { name: '외부 목록과 목적지' }).evaluate((heading) => heading.scrollIntoView({ block: 'start' }))
    await expect(page).toHaveScreenshot('place-import-acquisition-mapping-compact.png', { animations: 'disabled' })
  }
})

test('explains the isolated one-time remote login beta without opening it', async ({ page }) => {
  await routeSettings(page)
  await routeImportAcquisition(page)
  await page.goto('/settings?tab=import')

  await page.getByRole('button', { name: '원격 로그인 베타 확인' }).click()

  await expect(page.getByText('현재 PC의 NAVER 로그인을 사용하지 않습니다')).toBeVisible()
  await expect(page.getByText('운영 연동 준비 중')).toBeVisible()
  await expect(page.getByText('현재는 로그인 화면을 만들지 않습니다')).toBeVisible()
  await expect(page.getByRole('link', { name: 'NAVER 로그인 화면 열기' })).toHaveCount(0)
  await expect(page).toHaveScreenshot('place-import-acquisition-remote-beta.png', { animations: 'disabled' })
})

test('lets a member cancel a shared-link batch that is still processing', async ({ page }) => {
  await routeSettings(page)
  let current: Record<string, unknown> | undefined
  await page.route('**/api/v1/transfers/import-acquisitions', async (route) => {
    const command = route.request().postDataJSON() as StartAcquisitionCommand
    current = {
      schemaVersion: 'import-acquisition.v1', acquisitionId: command.acquisitionId,
      acquisitionRevision: 'processing-r1', importSourceId: command.importSourceId,
      providerKey: 'naver', method: 'shared-links', state: 'processing',
      items: [{ entryId: command.links?.[0]?.entryId, position: 0, state: 'pending' }],
      progress: { total: 1, processed: 0, ready: 0, failed: 0 },
      createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z',
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
      commandId: command.commandId, status: 'applied', acquisition: current,
    }) })
  })
  await page.route('**/api/v1/transfers/import-acquisition-commands', async (route) => {
    const command = route.request().postDataJSON() as { commandId: string }
    current = { ...current, acquisitionRevision: 'cancelled-r1', state: 'cancelled', updatedAt: '2026-09-05T08:00:01.000Z' }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
      commandId: command.commandId, status: 'applied', acquisition: current,
    }) })
  })

  await page.goto('/settings?tab=import')
  await page.getByLabel('NAVER 공유 링크').fill('https://naver.me/queued')
  await page.getByRole('button', { name: '링크 1개 확인' }).click()
  await page.getByRole('button', { name: '가져오기 취소' }).click()

  await expect(page.getByText('취소됨', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '가져오기 취소' })).toHaveCount(0)
})

test('does not offer cancellation after processing has started even if a failed row is dismissed', async ({ page }) => {
  await routeSettings(page)
  let current: Record<string, unknown> | undefined
  await page.route('**/api/v1/transfers/import-acquisitions', async (route) => {
    const command = route.request().postDataJSON() as StartAcquisitionCommand
    current = {
      schemaVersion: 'import-acquisition.v1', acquisitionId: command.acquisitionId,
      acquisitionRevision: 'fetching-r1', importSourceId: command.importSourceId,
      providerKey: 'naver', method: 'shared-links', state: 'processing',
      items: [
        { entryId: command.links?.[0]?.entryId, position: 0, state: 'invalid', failure: { code: 'invalid-url', retryable: false } },
        { entryId: command.links?.[1]?.entryId, position: 1, state: 'pending' },
      ],
      progress: { total: 2, processed: 1, ready: 0, failed: 1 },
      createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:01.000Z',
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
      commandId: command.commandId, status: 'applied', acquisition: current,
    }) })
  })
  await page.route('**/api/v1/transfers/import-acquisitions/*', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(current),
  }))

  await page.goto('/settings?tab=import')
  await page.getByLabel('NAVER 공유 링크').fill('https://naver.me/invalid\nhttps://naver.me/pending')
  await page.getByRole('button', { name: '링크 2개 확인' }).click()
  await page.getByRole('listitem').filter({ hasText: 'https://naver.me/invalid' })
    .getByRole('button', { name: '목록에서 제거' }).click()

  await expect(page.getByRole('button', { name: '가져오기 취소' })).toHaveCount(0)
})

test('keeps expanded match reviews open when one decision advances the plan revision', async ({ page }) => {
  await routeSettings(page)
  await routeImportAcquisition(page)
  await page.route('**/api/v4/transfers/import-plan-commands', async (route) => {
    const command = route.request().postDataJSON() as {
      commandId: string; kind: 'create' | 'decide-item'; planId: string; snapshotId?: string; sourceItemId?: string
    }
    const plan = largeReviewPlan(
      command.planId,
      command.snapshotId ?? '01992d20-0000-7000-8000-000000000084',
      command.kind === 'create' ? 'plan-r1' : 'plan-r2',
      command.kind === 'decide-item' ? command.sourceItemId : undefined,
    )
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'import-plan-command-result.v4', outcome: 'accepted',
      commandId: command.commandId, status: 'applied', plan,
    }) })
  })

  await page.goto('/settings?tab=import')
  await page.getByLabel('NAVER 공유 링크').fill([
    'https://naver.me/weekend', 'https://naver.me/coffee',
    'https://naver.me/weekend-copy', 'https://naver.me/private',
  ].join('\n'))
  await page.getByRole('button', { name: '링크 4개 확인' }).click()
  await page.getByRole('button', { name: '선택한 2개 목록 검토' }).click()
  await page.getByRole('button', { name: '매칭 미리보기' }).click()
  await page.getByRole('button', { name: '다음 51개 더 보기 · 51개 남음' }).click()
  await expect(page.getByText('검토 장소 151', { exact: true })).toBeVisible()

  await page.getByRole('listitem').filter({ hasText: '검토 장소 150' })
    .getByRole('button', { name: '건너뛰기' }).click()

  await expect(page.getByText('검토 장소 151', { exact: true })).toBeVisible()
})

test('a new shared-link request supersedes a slower stored recovery', async ({ page }) => {
  await routeSettings(page)
  const oldCommand: StartAcquisitionCommand = {
    commandId: '01992d20-0000-7000-8000-000000000081', kind: 'shared-links',
    acquisitionId: '01992d20-0000-7000-8000-000000000082',
    importSourceId: '01992d20-0000-7000-8000-000000000083',
    snapshotId: '01992d20-0000-7000-8000-000000000084',
    links: [{ entryId: '01992d20-0000-7000-8000-000000000085', position: 0, url: 'https://naver.me/old' }],
  }
  await page.addInitScript(({ acquisitionId }) => {
    window.sessionStorage.setItem('place.import-acquisition.shared.v1', acquisitionId)
  }, { acquisitionId: oldCommand.acquisitionId })
  let releaseRecovery = () => undefined
  const recoveryHold = new Promise<void>((resolve) => { releaseRecovery = resolve })
  await page.route('**/api/v1/transfers/import-acquisitions/*', async (route) => {
    await recoveryHold
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(singleReadyAcquisition(oldCommand, '이전 복구 목록')) })
  })
  await page.route('**/api/v1/transfers/import-acquisitions', async (route) => {
    const command = route.request().postDataJSON() as StartAcquisitionCommand
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
      commandId: command.commandId, status: 'applied',
      acquisition: singleReadyAcquisition(command, '새 요청 목록'),
    }) })
  })

  const recoveryRequest = page.waitForRequest((request) => request.url().includes(oldCommand.acquisitionId))
  await page.goto('/settings?tab=import')
  await recoveryRequest
  await page.getByLabel('NAVER 공유 링크').fill('https://naver.me/new')
  await page.getByRole('button', { name: '링크 1개 확인' }).click()
  await expect(page.getByText('새 요청 목록', { exact: true })).toBeVisible()
  releaseRecovery()
  await expect(page.getByText('이전 복구 목록', { exact: true })).toHaveCount(0)
  await expect(page.getByText('새 요청 목록', { exact: true })).toBeVisible()
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
        itemCount: 1, preview: { availability: 'available', addCount: 1, alreadyPresentCount: 0, unresolvedCount: 0, unsupportedCount: 0, items: [{ placeId, status: 'add', targetProviderPlaceId: 'naver-place-sensoji' }] },
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

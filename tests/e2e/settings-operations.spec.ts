import { expect, test, type Page } from '@playwright/test'

const operationId = '01992d20-0000-7000-8000-000000000301'
const connectionId = '01992d20-0000-7000-8000-000000000302'
const transferId = '01992d20-0000-7000-8000-000000000303'

function operation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'transfer-operation.v2', operationId, kind: 'outbound-transfer',
    providerKey: 'naver', connectionId, accountLabel: '여행 계정',
    resource: { kind: 'outbound-transfer', transferId }, stage: 'reconciling', state: 'outcome-unknown',
    progress: { total: 3, processed: 2, applied: 1, failed: 0, outcomeUnknown: 1 },
    operationRevision: 'operation-r1', attemptCount: 1, nextAttemptAt: null, actionRequired: null,
    allowedActions: ['reconcile'], lastError: { code: 'provider-timeout', retryable: true },
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:01:00.000Z', completedAt: null,
    ...overrides,
  }
}

async function routeOperations(page: Page) {
  let current = operation()
  let listReads = 0
  const commands: unknown[] = []

  await page.route('**/api/v2/transfers/provider-capabilities', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'provider-capability-list.v2', items: ['naver', 'google', 'kakao'].map((providerKey) => ({
        providerKey, displayName: providerKey === 'naver' ? 'NAVER' : providerKey === 'google' ? 'Google' : 'Kakao',
        connections: { availability: providerKey === 'naver' ? 'integration-gated' : 'unavailable', multipleAccounts: true, authMethods: [] },
        importSavedPlaces: { availability: providerKey === 'naver' ? 'integration-gated' : 'unavailable', reason: 'source-adapter-unavailable' },
        exportCollections: { availability: 'unavailable', reason: 'target-adapter-unavailable' },
      })),
    }),
  }))
  await page.route('**/api/v2/transfers/provider-connections', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'provider-connection-list.v2', items: [] }),
  }))
  await page.route('**/api/library/workspace?**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'personal-library-workspace.v2',
      filter: { favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
      collections: [], places: [],
      availableFilters: { coverage: { favoritePlaceCount: 0, sampledPlaceCount: 0, projectedPlaceCount: 0, complete: true }, areas: [], taxonomies: [] },
    }),
  }))
  await page.route('**/api/v2/operations/summary', (route) => {
    const state = current.state
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'transfer-operation-summary.v2',
      activeCount: ['queued', 'running', 'retry-scheduled'].includes(String(state)) ? 1 : 0,
      attentionCount: ['action-required', 'partial-failure', 'outcome-unknown', 'failed'].includes(String(state)) ? 1 : 0,
      actionRequiredCount: state === 'action-required' ? 1 : 0,
      outcomeUnknownCount: state === 'outcome-unknown' ? 1 : 0,
      latest: [current],
    }) })
  })
  await page.route(new RegExp(`/api/v2/operations/${operationId}/items(?:\\?.*)?$`), (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'transfer-operation-item-page.v2', operationId,
      items: [{ itemKey: 'remote-item-1', placeId: null, targetReference: 'naver-place-42', status: 'outcome-unknown', code: 'provider-timeout', retryable: true, updatedAt: '2026-09-03T00:01:00.000Z' }],
    }),
  }))
  await page.route(new RegExp(`/api/v2/operations/${operationId}$`), (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(current),
  }))
  await page.route(/\/api\/v2\/operations\?.*$/, (route) => {
    listReads += 1
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'transfer-operation-list.v2', items: [current],
    }) })
  })
  await page.route('**/api/v2/operation-commands', async (route) => {
    const command = route.request().postDataJSON()
    commands.push(command)
    current = operation({
      stage: 'reconciling', state: 'running', operationRevision: 'operation-r2',
      allowedActions: ['cancel'], lastError: null, updatedAt: '2026-09-03T00:02:00.000Z',
    })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 'transfer-operation-command-result.v2', outcome: 'accepted', commandId: command.commandId,
      status: 'applied', operation: current,
    }) })
  })

  return {
    commands,
    get listReads() { return listReads },
    completeExternally() {
      current = operation({
        stage: 'externally-completed', state: 'completed', operationRevision: 'operation-r3',
        progress: { total: 3, processed: 3, applied: 3, failed: 0, outcomeUnknown: 0 },
        allowedActions: [], lastError: null, updatedAt: '2026-09-03T00:03:00.000Z', completedAt: '2026-09-03T00:03:00.000Z',
      })
    },
  }
}

test('recovers durable operation state after reload and safely reconciles an unknown outcome', async ({ page }, testInfo) => {
  const server = await routeOperations(page)
  await page.goto('/settings?tab=history')

  await expect(page.getByRole('heading', { name: '작업 내역' })).toBeVisible()
  await expect(page.getByText('같은 쓰기를 다시 보내지 않습니다')).toBeVisible()
  await expect(page.getByText('provider-timeout').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /작업 알림 1개/ })).toBeVisible()
  if (testInfo.project.name === 'desktop-chromium') {
    await expect(page.getByRole('link', { name: /현재 작업 상태: 확인 1개/ })).toBeVisible()
  }

  await page.getByRole('button', { name: '외부 결과 확인' }).click()
  await expect(page.getByText('외부 결과 대조 중').first()).toBeVisible()
  expect(server.commands).toHaveLength(1)
  expect(server.commands[0]).toMatchObject({
    schemaVersion: 'transfer-operation-command.v2', operationId,
    expectedOperationRevision: 'operation-r1', action: 'reconcile',
  })

  server.completeExternally()
  const readsBeforeReload = server.listReads
  await page.reload()
  await expect(page.getByText('외부 서비스 반영 완료').first()).toBeVisible()
  expect(server.listReads).toBeGreaterThan(readsBeforeReload)
  await page.getByRole('tab', { name: '데이터 가져오기' }).click()
  await expect(page.getByRole('button', { name: '새 수집 시작' })).toBeDisabled()
})

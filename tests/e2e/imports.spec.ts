import { expect, test, type Page, type Route } from '@playwright/test'

const connectionId = '01992d20-7000-7000-8000-000000000001'
const batchId = '01992d20-7000-7000-8000-000000000002'
const duplicateItemId = '01992d20-7000-7000-8000-000000000003'
const incompleteItemId = '01992d20-7000-7000-8000-000000000004'
const canonicalPlaceId = '01992d20-7000-7000-8000-000000000005'
const installationId = '01992d20-7000-7000-8000-000000000006'
const operationId = '01992d20-7000-7000-8000-000000000007'
const timestamp = '2026-08-26T00:00:00.000Z'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function batch(state: string) {
  const resolved = reviewedItems.size
  return {
    schemaVersion: 'place-import-batch.v1', batchId, connectionId, providerKey: 'naver', state,
    progress: {
      discovered: state === 'queued' ? 0 : 2,
      ready: state === 'needs-review' || state === 'enriching' ? 0 : 1,
      reviewRequired: state === 'completed' ? 0 : state === 'needs-review' ? 2 - resolved : 1,
      enriching: state === 'enriching' ? 1 : 0,
      applied: state === 'completed' ? 2 : resolved, skipped: 0, failed: 0,
    },
    createdAt: timestamp, updatedAt: timestamp,
  }
}

function detail(state: string) {
  return {
    schemaVersion: 'place-import-batch-detail.v1', batch: batch(state),
    items: state === 'partial' ? [] : [
      {
        schemaVersion: 'place-import-item.v1', itemId: duplicateItemId, batchId,
        providerKey: 'naver', providerPlaceId: 'naver-place-1', listName: '후쿠오카 여행',
        name: '신카이 라멘 본점', address: '일본 후쿠오카시 하카타구', categoryLabel: '라멘',
        location: { latitude: 33.5902, longitude: 130.4207 },
        status: state === 'completed' || reviewedItems.has(duplicateItemId)
          ? 'applied'
          : state === 'enriching' ? 'enriching' : 'needs-review',
        reviewReasons: state === 'enriching' || state === 'completed' ? [] : ['possible-duplicate'],
      },
      {
        schemaVersion: 'place-import-item.v1', itemId: incompleteItemId, batchId,
        providerKey: 'naver', listName: '가보고 싶은 곳', name: '이름만 기록한 여행 장소',
        address: null, categoryLabel: null, location: null,
        status: state === 'completed' || reviewedItems.has(incompleteItemId) ? 'applied' : 'needs-review',
        reviewReasons: state === 'completed' ? [] : ['missing-address', 'provider-place-id-unavailable'],
      },
    ],
  }
}

const reviewedItems = new Set<string>()

async function installImportFixture(page: Page, withConnection = true) {
  reviewedItems.clear()
  let phase: 'partial' | 'cancelled' | 'enriching' | 'needs-review' | 'completed' = 'partial'
  let enrichingReads = 0
  const reviewBodies: unknown[] = []
  await page.route('**/api/imports/connections', (route) => json(route, {
    schemaVersion: 'place-provider-connections.v1',
    items: withConnection ? [{
      schemaVersion: 'place-provider-connection.v1', connectionId, providerKey: 'naver',
      label: '내 NAVER 저장목록', status: 'ready', lastVerifiedAt: timestamp,
    }] : [],
  }))
  await page.route('**/api/imports', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return json(route, batch('queued'), 202)
  })
  await page.route(`**/api/imports/${batchId}`, (route) => {
    const response = detail(phase)
    if (phase === 'enriching') {
      enrichingReads += 1
      if (enrichingReads >= 2) phase = 'needs-review'
    }
    return json(route, response)
  })
  await page.route(`**/api/imports/${batchId}/cancel`, (route) => {
    phase = 'cancelled'
    return json(route, batch('cancelled'))
  })
  await page.route(`**/api/imports/${batchId}/resume`, (route) => {
    phase = 'enriching'
    return json(route, batch('queued'))
  })
  await page.route('**/api/import-reviews', async (route) => {
    const body = route.request().postDataJSON()
    reviewBodies.push(body)
    if (body.itemId === duplicateItemId && reviewBodies.filter((item) => (
      item as { itemId?: string }
    ).itemId === duplicateItemId).length === 1) {
      reviewedItems.add(duplicateItemId)
      return json(route, {
        type: 'urn:place:error:import-temporarily-unavailable',
        title: '검토 결과를 확인하지 못했습니다.', status: 503,
        code: 'PLACE_IMPORT_REVIEW_UNAVAILABLE', retryable: true, correlationRef: 'review-retry',
      }, 503)
    }
    reviewedItems.add(body.itemId)
    if (reviewedItems.size === 2) phase = 'completed'
    return json(route, {
      schemaVersion: 'place-import-review-result.v1', commandId: body.commandId,
      itemId: body.itemId, status: body.itemId === duplicateItemId ? 'replayed' : 'applied',
      canonicalPlaceId: body.action.kind === 'link-place' ? body.action.canonicalPlaceId : canonicalPlaceId,
    })
  })
  return { reviewBodies, complete: () => { phase = 'completed' } }
}

async function installFakeConnector(page: Page) {
  await page.addInitScript(({ installationId, batchId }) => {
    window.addEventListener('message', (event) => {
      const command = event.data
      if (event.source !== window || command?.channel !== 'place-connector') return
      const base = {
        schemaVersion: 'place-connector-event.v1', channel: 'place-connector',
        requestId: command.requestId,
      }
      if (command.kind === 'probe') {
        window.postMessage({
          ...base, kind: 'ready', installationId, browserKey: 'whale',
          supportedProviders: ['naver'],
        }, window.location.origin)
      }
      if (command.kind === 'prepare-import') {
        window.postMessage({ ...base, kind: 'prepared', providerKey: 'naver', allowed: true }, window.location.origin)
      }
      if (command.kind === 'start-import') {
        window.postMessage({
          ...base, kind: 'progress', operationId: command.grant.operationId,
          progress: {
            phase: 'submitting', discoveredItems: 2, capturedItems: 2,
            submittedItems: 1, submittedBatches: 1,
          },
        }, window.location.origin)
        window.postMessage({
          ...base, kind: 'result', operationId: command.grant.operationId,
          code: 'completed', retryable: false, importBatchId: batchId,
        }, window.location.origin)
      }
    })
  }, { installationId, batchId })
}

test('reviews a resumable NAVER import without exposing provider account material', async ({ page }) => {
  const { reviewBodies } = await installImportFixture(page)
  await page.goto('/imports')

  await expect(page.getByRole('heading', { name: '저장 목록 가져오기' })).toBeVisible()
  await expect(page.getByText('내 NAVER 저장목록')).toBeVisible()
  await page.getByRole('button', { name: '서버 수집 시작' }).click()
  await expect(page.getByText('일부 목록을 가져온 뒤 다음 묶음을 기다리고 있습니다.')).toBeVisible()

  await page.getByRole('button', { name: '가져오기 취소' }).click()
  await expect(page.getByText('가져오기가 취소되었습니다.')).toBeVisible()
  await page.getByRole('button', { name: '가져오기 재개' }).click()

  const duplicate = page.getByRole('listitem').filter({ hasText: '신카이 라멘 본점' })
  const incomplete = page.getByRole('listitem').filter({ hasText: '이름만 기록한 여행 장소' })
  await expect(page.getByText('장소의 최신 상세 정보를 확인하고 있습니다.')).toBeVisible()
  await expect(duplicate).toContainText('상세 확인 중')
  await expect(duplicate.getByRole('button', { name: '새 장소로 저장' })).toHaveCount(0)

  await duplicate.getByRole('button', { name: '새 장소로 저장' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '검토 결과를 확인하지 못했습니다.' })).toBeVisible()
  await duplicate.getByRole('button', { name: '새 장소로 저장' }).click()
  await expect(duplicate).toContainText('저장 완료')

  await incomplete.getByLabel('연결할 기존 장소 ID').fill(canonicalPlaceId)
  await incomplete.getByRole('button', { name: '기존 장소에 연결' }).click()
  await expect(incomplete).toContainText('저장 완료')
  await expect(page.getByText('가져오기가 완료되었습니다.')).toBeVisible()

  const duplicateCommands = reviewBodies.filter((body) => (
    body as { itemId?: string }
  ).itemId === duplicateItemId) as Array<{ commandId: string }>
  expect(duplicateCommands).toHaveLength(2)
  expect(duplicateCommands[0]?.commandId).toBe(duplicateCommands[1]?.commandId)
  expect(JSON.stringify(reviewBodies)).not.toMatch(/token|profile|cookie|secret/i)
})

test('detects a fake Whale connector and starts the browser-session import flow', async ({ page }) => {
  const fixture = await installImportFixture(page, false)
  fixture.complete()
  await installFakeConnector(page)
  await page.route('**/api/connector/grants', async (route) => {
    const request = route.request().postDataJSON()
    return json(route, {
      schemaVersion: 'place-connector-grant.v1', operationId,
      providerKey: 'naver', operation: 'import-saved-library',
      idempotencyKey: request.idempotencyKey,
      token: 'opaque.connector.grant.token.that.is.long.enough',
      placeOrigin: new URL(route.request().url()).origin,
      expiresAt: '2026-08-26T12:00:00.000Z',
      limits: {
        maximumItems: 100_000, maximumBytes: 134_217_728,
        maximumBatches: 1_000, maximumBatchBytes: 4_194_304,
      },
    })
  })
  await page.goto('/imports')

  await expect(page.getByText('확장 프로그램 연결됨 · NAVER 사용 가능')).toBeVisible()
  await expect(page.getByText('whale', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '이 브라우저에서 NAVER 가져오기' }).click()
  await expect(page.getByText('가져오기가 완료되었습니다.')).toBeVisible()
  await expect(page.getByText('후쿠오카 여행')).toBeVisible()
  await expect(page.getByText('가보고 싶은 곳')).toBeVisible()
})

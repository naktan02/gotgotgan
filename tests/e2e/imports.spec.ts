import { expect, test, type Page, type Route } from '@playwright/test'

const connectionId = '01992d20-7000-7000-8000-000000000001'
const batchId = '01992d20-7000-7000-8000-000000000002'
const duplicateItemId = '01992d20-7000-7000-8000-000000000003'
const incompleteItemId = '01992d20-7000-7000-8000-000000000004'
const canonicalPlaceId = '01992d20-7000-7000-8000-000000000005'
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
      applied: resolved, skipped: 0, failed: 0,
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
        providerKey: 'naver', providerPlaceId: 'naver-place-1', listName: '후쿠오카',
        name: '센카이 라멘 본점', address: '후쿠오카시 하카타구', categoryLabel: '라멘',
        location: { latitude: 33.5902, longitude: 130.4207 },
        status: reviewedItems.has(duplicateItemId)
          ? 'applied'
          : state === 'enriching' ? 'enriching' : 'needs-review',
        reviewReasons: state === 'enriching' ? [] : ['possible-duplicate'],
      },
      {
        schemaVersion: 'place-import-item.v1', itemId: incompleteItemId, batchId,
        providerKey: 'naver', listName: '가보고 싶은 곳', name: '이름이 긴 여행 장소',
        address: null, categoryLabel: null, location: null,
        status: reviewedItems.has(incompleteItemId) ? 'applied' : 'needs-review',
        reviewReasons: ['missing-address', 'provider-place-id-unavailable'],
      },
    ],
  }
}

const reviewedItems = new Set<string>()

async function installImportFixture(page: Page) {
  reviewedItems.clear()
  let phase: 'partial' | 'cancelled' | 'enriching' | 'needs-review' = 'partial'
  let enrichingReads = 0
  const reviewBodies: unknown[] = []
  await page.route('**/api/imports/connections', (route) => json(route, {
    schemaVersion: 'place-provider-connections.v1',
    items: [{
      schemaVersion: 'place-provider-connection.v1', connectionId, providerKey: 'naver',
      label: '내 NAVER 저장목록', status: 'ready', lastVerifiedAt: timestamp,
    }],
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
        title: '검토 결과를 확인하지 못했습니다', status: 503,
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
  return reviewBodies
}

test('reviews a resumable NAVER import without exposing provider account material', async ({ page }) => {
  const reviewBodies = await installImportFixture(page)
  await page.goto('/imports')

  await expect(page.getByRole('heading', { name: '저장목록 가져오기' })).toBeVisible()
  await expect(page.getByText('내 NAVER 저장목록')).toBeVisible()
  await page.getByRole('button', { name: '가져오기 시작' }).click()
  await expect(page.getByText('일부 항목을 가져오는 중입니다.')).toBeVisible()

  await page.getByRole('button', { name: '가져오기 취소' }).click()
  await expect(page.getByText('가져오기가 취소되었습니다.')).toBeVisible()
  await page.getByRole('button', { name: '가져오기 재개' }).click()

  const duplicate = page.getByRole('listitem').filter({ hasText: '센카이 라멘 본점' })
  const incomplete = page.getByRole('listitem').filter({ hasText: '이름이 긴 여행 장소' })
  await expect(page.getByText('새 장소의 상세정보를 확인하는 중입니다.')).toBeVisible()
  await expect(duplicate).toContainText('상세 확인 중')
  await expect(duplicate.getByRole('button', { name: '새 장소로 저장' })).toHaveCount(0)
  await expect(duplicate).toContainText('중복 가능성')
  await expect(incomplete).toContainText('주소 없음')

  await duplicate.getByRole('button', { name: '새 장소로 저장' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '검토 결과를 확인하지 못했습니다' })).toBeVisible()
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

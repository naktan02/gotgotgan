import { expect, test } from '@playwright/test'

const collectionPublicationId = '01992d20-0000-7000-8000-000000000001'
const writingPublicationId = '01992d20-0000-7000-8000-000000000002'
const privateIdentifier = '01992d20-0000-7000-8000-000000000099'

test('renders only allowlisted collection and writing publications', async ({ page, request }, testInfo) => {
  const copyCommands: unknown[] = []
  await page.route('**/api/library/commands', (route) => {
    copyCommands.push(route.request().postDataJSON())
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 'library-command-result.v1', status: 'applied' }),
    })
  })
  await page.goto(`/share/collections/${collectionPublicationId}`)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('heading', { name: '성수에서 다시 갈 곳' })).toBeVisible()
  await expect(page.getByRole('button', { name: '두 번째 페이지 카페 지도에서 선택' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('shared-list.png') })
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 1280, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('shared-list-1280.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.getByText('목록 소개', { exact: true }).click()
  await expect(page.getByText('링크를 받은 사람에게만 보이는 컬렉션')).toBeVisible()
  await expect(page.getByRole('list', { name: '공유된 장소' })).toContainText('조용한 라멘 연구소')
  await expect(page.getByRole('list', { name: '공유된 장소' })).toContainText('라멘 · 서울 성동구 성수동')
  await expect(page.getByText('장소 정보를 준비 중입니다.').first()).toBeVisible()
  await expect(page.getByText('전체 51개 · 50개 불러옴')).toBeVisible()
  await expect(page.getByRole('list', { name: '공유된 장소' }))
    .not.toContainText('두 번째 페이지 카페')
  const map = page.getByRole('region', { name: '공유 컬렉션 지도' })
  await expect(map.getByRole('button', { name: '두 번째 페이지 카페 지도에서 선택' }))
    .toBeVisible()
  await page.getByRole('list', { name: '공유된 장소' })
    .getByRole('button', { name: /조용한 라멘 연구소/ }).click()
  const placeDetail = page.getByRole('region', { name: '공개 장소 상세' })
  await expect(placeDetail.getByRole('heading', { name: '조용한 라멘 연구소' })).toBeVisible()
  await expect(placeDetail).toContainText('라멘')
  await expect(placeDetail).toContainText('37.54450, 127.05600')
  await expect(placeDetail).not.toContainText('내 평점')
  await expect(page.getByRole('list', { name: '공유된 장소' })).toBeHidden()
  await expect(map).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('shared-place-detail.png') })
  await placeDetail.getByRole('button', { name: '공유 장소 목록으로 돌아가기' }).click()
  await map.getByRole('button', { name: '두 번째 페이지 카페 지도에서 선택' }).click()
  await expect(page.getByRole('button', { name: '공유 목록 패널 접기' })).toHaveAttribute('aria-expanded', 'true')
  await expect(placeDetail.getByRole('heading', { name: '두 번째 페이지 카페' })).toBeVisible()
  await placeDetail.getByRole('button', { name: '공유 장소 목록으로 돌아가기' }).click()
  await page.getByRole('button', { name: '장소 더 보기' }).click()
  await expect(page.getByRole('list', { name: '공유된 장소' }))
    .toContainText('두 번째 페이지 카페')
  await expect(page.getByText('전체 51개 · 51개 불러옴')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('membership')
  await expect(page.locator('body')).not.toContainText('4.4')
  await expect(page.locator('body')).not.toContainText('01992d20-0000-7000-8000-000000000003')
  await page.getByRole('button', { name: '내 곳곳간으로 복사' }).click()
  await expect(page.getByRole('link', { name: '내 곳곳간에서 보기' })).toBeVisible()
  await expect(page.getByRole('link', { name: '내 곳곳간에서 보기' })).toHaveAttribute('href', '/library')
  expect(copyCommands).toHaveLength(1)
  expect(copyCommands[0]).toMatchObject({
    command: {
      kind: 'copy-published-collection',
      sourcePublicationId: collectionPublicationId,
      targetName: '성수에서 다시 갈 곳',
    },
  })
  expect(copyCommands[0]).not.toHaveProperty('memberId')

  await page.goto(`/share/writing/${writingPublicationId}`)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('heading', { name: '성수의 하루' })).toBeVisible()
  await expect(page.getByText('공개하기로 선택한 글만 표시합니다.')).toBeVisible()

  const hidden = await request.get(`/api/public/collections/${privateIdentifier}`)
  expect(hidden.status()).toBe(404)
  expect(await hidden.json()).toMatchObject({ code: 'PLACE_PUBLICATION_NOT_FOUND' })
})

test('restores the original list position and focus after consecutive map selections', async ({ page }) => {
  await page.goto(`/share/collections/${collectionPublicationId}`)
  await page.getByRole('button', { name: '장소 더 보기' }).click()
  const originalPlace = page.getByRole('list', { name: '공유된 장소' })
    .getByRole('button', { name: /두 번째 페이지 카페/ })
  await originalPlace.scrollIntoViewIfNeeded()
  await expect(originalPlace).toBeInViewport()
  await expect(page.getByRole('heading', { name: '성수에서 다시 갈 곳' })).not.toBeInViewport()
  const originalPosition = (await originalPlace.boundingBox())!.y
  await originalPlace.click()

  const detail = page.getByRole('region', { name: '공개 장소 상세' })
  const map = page.getByRole('region', { name: '공유 컬렉션 지도' })
  await expect(detail.getByRole('heading', { name: '두 번째 페이지 카페' })).toBeVisible()
  await map.getByRole('button', { name: '조용한 라멘 연구소 지도에서 선택' }).click()
  await expect(detail.getByRole('heading', { name: '조용한 라멘 연구소' })).toBeVisible()
  await map.getByRole('button', { name: '두 번째 페이지 카페 지도에서 선택' }).click()
  await expect(detail.getByRole('heading', { name: '두 번째 페이지 카페' })).toBeVisible()
  await detail.getByRole('button', { name: '공유 장소 목록으로 돌아가기' }).click()

  await expect.poll(async () => Math.abs((await originalPlace.boundingBox())!.y - originalPosition))
    .toBeLessThanOrEqual(1)
  await expect(originalPlace).toBeFocused()
})

test('keeps public collection content comfortably inside a 360px viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'narrow public Collection layout coverage')
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`/share/collections/${collectionPublicationId}`)
  await expect(page.getByRole('button', { name: '두 번째 페이지 카페 지도에서 선택' })).toBeVisible()

  const panel = page.locator('#published-collection-panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect(box?.width).toBeLessThanOrEqual(360)
  const mapBox = await page.getByRole('region', { name: '공유 컬렉션 지도' }).boundingBox()
  expect(mapBox).not.toBeNull()
  expect((mapBox?.y ?? 0) + (mapBox?.height ?? 0)).toBeLessThanOrEqual((box?.y ?? 0) + 1)
  await page.screenshot({ path: testInfo.outputPath('shared-mobile-360.png'), scale: 'css' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '공유 목록 패널 접기' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('region', { name: '공유 컬렉션 지도' })).toBeVisible()
  await page.getByRole('button', { name: '공유 목록 패널 펼치기' }).click()
  await expect(panel).toBeVisible()
})

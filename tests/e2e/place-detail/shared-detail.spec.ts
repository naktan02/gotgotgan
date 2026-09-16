import { expect, test, type Page } from '@playwright/test'
import { installEmptyFiling, installMemberDetail } from './fixture'

async function openHomeDetail(page: Page) {
  await page.goto('/')
  const input = page.getByRole('combobox', { name: '곳곳간 카탈로그 검색', exact: true })
  await input.fill('성수 라멘')
  await input.press('Enter')
  await page.locator('ol').getByRole('button').first().click()
  return page.getByRole('region', { name: '선택한 장소', exact: true })
}

test('offers the shared private detail, whole-star keyboard focus, and guarded note shortcuts from Home', async ({ page }, testInfo) => {
  await installMemberDetail(page)
  await installEmptyFiling(page)
  const widths = testInfo.project.name === 'desktop-chromium' ? [1440, 1280] : [390, 360]
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 390 ? 844 : 800 })
    const detail = await openHomeDetail(page)
    await expect(detail.getByRole('button', { name: /내 목록에 저장.*변경/ })).toBeVisible()
    await expect(detail.getByRole('button', { name: '태그 추가' })).toBeVisible()
    await expect(detail.getByRole('button', { name: '메모 작성' })).toBeVisible()
    await expect(detail).not.toContainText('37.5445')
    await expect(detail).not.toContainText('정보 상태')
    await page.screenshot({ path: testInfo.outputPath(`home-shared-detail-${width}.png`) })
    const rating = detail.getByRole('region', { name: '내 평점' })
    await expect(rating).toContainText('4.7')
    const edit = rating.getByRole('button', { name: /평가하기/ })
    await edit.click()
    const half = rating.getByRole('radio', { name: '별점 3.5점', exact: true })
    await half.check()
    await expect(half.locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(half.locator('../..')).toHaveCSS('outline-style', 'none')
    await edit.focus()
    await edit.press('Tab')
    await expect(half).toBeFocused()
    await expect(half.locator('../..')).toHaveCSS('outline-style', 'solid')
    await page.screenshot({ path: testInfo.outputPath(`home-keyboard-stars-${width}.png`) })
    await detail.getByRole('button', { name: '메모 작성' }).click()
    await expect(detail.getByRole('tab', { name: '내 기록', exact: true })).toHaveAttribute('aria-selected', 'true')
    await detail.getByLabel('새 비공개 메모', { exact: true }).fill('fixture 미저장 메모')
    const tabs = detail.getByRole('tablist', { name: '장소 상세 항목' })
    const scroller = page.locator('[data-detail-scroll]')
    await expect.poll(async () => (await tabs.boundingBox())!.y - (await scroller.boundingBox())!.y)
      .toBeLessThanOrEqual(1)
    const recordGap = async () => {
      const tabBounds = (await tabs.boundingBox())!
      return (await detail.locator('[data-record="notes"] > summary').boundingBox())!.y - tabBounds.y - tabBounds.height
    }
    await expect.poll(recordGap).toBeGreaterThanOrEqual(7)
    if (width < 720) {
      await expect.poll(recordGap).toBeLessThanOrEqual(9)
      const map = page.getByRole('region', { name: '곳곳간 카탈로그 검색 지도' })
      await expect.poll(async () => (await map.boundingBox())!.height).toBeGreaterThanOrEqual(184)
      const inputBounds = (await detail.getByLabel('새 비공개 메모', { exact: true }).boundingBox())!
      const panelBounds = (await page.getByRole('complementary', { name: '카탈로그 탐색 패널' }).boundingBox())!
      expect(inputBounds.height).toBeLessThan(panelBounds.height - 100)
    }
    await page.screenshot({ path: testInfo.outputPath(`home-note-shortcut-${width}.png`) })
    await page.getByRole('button', { name: '검색 결과로', exact: false }).click()
    const guard = page.getByRole('dialog', { name: '저장하지 않은 변경이 있어요' })
    await expect(guard).toContainText('내 별점')
    await expect(guard).toContainText('메모')
    await guard.getByRole('button', { name: '계속 작성' }).click()
    await expect(detail.getByLabel('새 비공개 메모', { exact: true })).toHaveValue('fixture 미저장 메모')
    await page.getByRole('button', { name: '검색 결과로', exact: false }).click()
    await guard.getByRole('button', { name: '저장하지 않고 이동' }).click()
    await expect(page.locator('ol').getByRole('button')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  }
})

test('creates and attaches a tag with replay-safe recovery, then selects existing tags', async ({ page }, testInfo) => {
  const fixture = await installMemberDetail(page, { loseAttachmentOnce: true })
  await installEmptyFiling(page)
  const detail = await openHomeDetail(page)
  await detail.getByRole('button', { name: '태그 추가' }).click()
  await detail.getByLabel('새 개인 태그', { exact: true }).fill('다시 먹을 곳')
  await detail.getByRole('button', { name: '만들고 이 장소에 추가' }).click()
  await expect(detail.getByRole('alert')).toContainText('같은 요청')
  await detail.getByRole('button', { name: '같은 요청 다시 확인' }).click()
  const created = detail.getByRole('button', { name: '다시 먹을 곳 포함됨' })
  await expect(created).toHaveAttribute('aria-pressed', 'true')
  expect(fixture.commands).toHaveLength(3)
  expect(fixture.commands[0]?.command.kind).toBe('create-tag')
  expect(fixture.commands[1]).toEqual(fixture.commands[2])
  await detail.getByRole('searchbox', { name: '불러온 태그에서 찾기' }).fill('진한')
  await detail.getByRole('button', { name: '진한 국물 추가' }).click()
  await expect(detail.getByRole('button', { name: '진한 국물 포함됨' })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: testInfo.outputPath('home-tags.png') })
})

test('distinguishes sign-in and denied personal access from service failure', async ({ page }) => {
  for (const status of [401, 403]) {
    await page.route(/\/api\/v2\/places\/[^/]+$/, (route) => route.fulfill({ status, json: {} }))
    const detail = await openHomeDetail(page)
    await expect(detail.getByRole('heading', { name: '조용한 라멘 연구소' })).toBeVisible()
    if (status === 401) await expect(detail.getByRole('link', { name: '로그인하고 계속' })).toBeVisible()
    else {
      await expect(detail).toContainText('현재 계정에서는 개인 기록을 변경할 수 없습니다.')
      await expect(detail.getByRole('link', { name: '로그인하고 계속' })).toHaveCount(0)
    }
    await expect(detail.getByRole('alert')).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '태그 추가' })).toHaveCount(0)
  }
})

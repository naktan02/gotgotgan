import type { Page } from '@playwright/test'
import type { BrowserLibraryCommandRequest } from '@place/contracts/http'

const timestamp = '2026-09-03T00:00:00.000Z'

export async function installMemberDetail(page: Page, options: { loseAttachmentOnce?: boolean } = {}) {
  const commands: BrowserLibraryCommandRequest[] = []
  const tags = new Map([['01992d20-7000-7000-8000-000000000201', { name: '진한 국물', selected: false }]])
  let loseAttachment = options.loseAttachmentOnce ?? false
  await page.route(/\/api\/v2\/places\/[^/]+$/, (route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').at(-1)!
    return route.fulfill({ json: {
      schemaVersion: 'place-detail.v2', requestedPlaceId: placeId, placeId, redirectedFrom: [], status: 'available',
      name: placeId.endsWith('104') ? '성수 골목 쇼유라멘' : '조용한 라멘 연구소',
      areaLabel: '서울 성동구 성수동', location: { latitude: 37.5445, longitude: 127.056 },
      primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' }, taxonomyKeys: ['food', 'food.noodle.ramen'],
      evidence: { status: 'verified', projectedAt: timestamp },
      personalState: { saved: false, wanted: false, personalRating: 4.7, preferencesUpdatedAt: timestamp, visits: { visited: false, count: 0 } },
    } })
  })
  await page.route('**/api/library/places/*/organization?*', (route) => route.fulfill({ json: {
    schemaVersion: 'library-place-organization.v1', placeId: new URL(route.request().url()).pathname.split('/').at(-2),
    items: [...tags].map(([tagId, value]) => ({ kind: 'tag', tagId, ...value })),
  } }))
  await page.route('**/api/places/*/visits?*', (route) => route.fulfill({ json: {
    schemaVersion: 'visit-history.v1', placeId: new URL(route.request().url()).pathname.split('/').at(-2), items: [],
  } }))
  await page.route('**/api/writing?*', (route) => route.fulfill({ json: {
    schemaVersion: 'writing-list.v2', filter: { kind: 'note', placeId: new URL(route.request().url()).searchParams.get('placeId') }, items: [],
  } }))
  await page.route('**/api/library/commands', async (route) => {
    const request = route.request().postDataJSON() as BrowserLibraryCommandRequest
    commands.push(request)
    const command = request.command
    if (command.kind === 'create-tag') tags.set(command.tagId, { name: command.name, selected: false })
    if (command.kind === 'tag-place' || command.kind === 'untag-place') {
      tags.get(command.tagId)!.selected = command.kind === 'tag-place'
      if (loseAttachment) {
        loseAttachment = false
        return route.fulfill({ status: 503, json: {} })
      }
    }
    return route.fulfill({ json: { schemaVersion: 'library-command-result.v1', status: 'applied' } })
  })
  return { commands, tags }
}

export async function installEmptyFiling(page: Page) {
  await page.route('**/api/library/places/*/filing?*', (route) => route.fulfill({ json: {
    schemaVersion: 'place-filing.v2', placeId: new URL(route.request().url()).pathname.split('/').at(-2),
    overlay: { isFavorited: false, collectionCount: 0, personalRating: 4.7 }, collections: [],
  } }))
}

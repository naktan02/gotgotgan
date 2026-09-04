import { expect, test, type Page, type Route } from '@playwright/test'
import type {
  CollectionLifecycleCommandRequestV2,
  PlaceFilingCommandRequestV2,
} from '@place/contracts/library'

const ramenPlaceId = '01992d20-7000-7000-8000-000000000101'
const museumPlaceId = '01992d20-7000-7000-8000-000000000102'
const ramenCollectionId = '01992d20-7000-7000-8000-000000000301'
const tokyoCollectionId = '01992d20-7000-7000-8000-000000000302'
const ramenTagId = '01992d20-7000-7000-8000-000000000201'
const timestamp = '2026-09-03T00:00:00.000Z'
const seongsuAreaKey = 'area_abcdefghijklmnopqrstuv'
const uenoAreaKey = 'area_vutsrqponmlkjihgfedcba'

type Collection = {
  collectionId: string
  name: string
  description: string | null
  placeIds: string[]
  revision: number
}

type LibraryFixtureOptions = Readonly<{
  conflictOnce?: boolean
  responseLossOnce?: boolean
}>

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function revision(collection: Collection) {
  return `collection-revision.v1.${collection.collectionId}.${collection.revision}`
}

const places = {
  [ramenPlaceId]: {
    placeId: ramenPlaceId,
    name: '멘야 하루',
    areaLabel: '서울 성동구 성수동',
    location: { latitude: 37.5447, longitude: 127.0557 },
    primaryTaxonomy: { key: 'ramen.shoyu', label: '쇼유라멘' },
    taxonomyKeys: ['food', 'ramen', 'ramen.shoyu'],
    evidence: { status: 'verified', projectedAt: timestamp },
  },
  [museumPlaceId]: {
    placeId: museumPlaceId,
    name: '도쿄 새 박물관',
    areaLabel: '도쿄 우에노',
    location: null,
    primaryTaxonomy: { key: 'attraction.museum', label: '박물관' },
    taxonomyKeys: ['attraction', 'attraction.museum'],
    evidence: { status: 'unverified', projectedAt: timestamp },
  },
} as const

function problem(status: number, code: string) {
  return {
    type: `urn:gotgotgan:error:${code.toLowerCase()}`,
    title: code,
    status,
    code,
    retryable: status === 409 || status === 503,
    correlationRef: `e2e-${status}`,
  }
}

async function installCollectionLibraryFixture(page: Page, options: LibraryFixtureOptions = {}) {
  const collections = new Map<string, Collection>([
    [ramenCollectionId, {
      collectionId: ramenCollectionId,
      name: '서울 라멘',
      description: '다시 먹고 싶은 라멘집',
      placeIds: [ramenPlaceId],
      revision: 1,
    }],
    [tokyoCollectionId, {
      collectionId: tokyoCollectionId,
      name: '도쿄 여행',
      description: '도쿄에서 둘러볼 곳',
      placeIds: [museumPlaceId],
      revision: 1,
    }],
  ])
  const filingCommands: PlaceFilingCommandRequestV2[] = []
  const lifecycleCommands: CollectionLifecycleCommandRequestV2[] = []
  const applied = new Set<string>()
  let conflictPending = options.conflictOnce ?? false
  let responseLossPending = options.responseLossOnce ?? false

  const workspace = (route: Route) => {
    const url = new URL(route.request().url())
    const selectedCollectionId = url.searchParams.get('collectionId')
    const areaKeys = url.searchParams.getAll('areaKeys')
    const taxonomyKeys = url.searchParams.getAll('taxonomyKeys')
    const rating = url.searchParams.get('rating') ?? 'any'
    const selected = selectedCollectionId === null
      ? [...new Set([...collections.values()].flatMap((collection) => collection.placeIds))]
      : collections.get(selectedCollectionId)?.placeIds ?? []
    const items = selected.filter((placeId) => {
      const place = places[placeId as keyof typeof places]
      if (place === undefined) return false
      if (rating === 'unrated' && placeId === ramenPlaceId) return false
      if (rating === 'rated' && placeId !== ramenPlaceId) return false
      if (areaKeys.length > 0 && !areaKeys.includes(placeId === ramenPlaceId ? seongsuAreaKey : uenoAreaKey)) return false
      return taxonomyKeys.length === 0 || taxonomyKeys.some((key) => place.taxonomyKeys.includes(key as never))
    })
    return json(route, {
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: selectedCollectionId === null
          ? { kind: 'all' }
          : { kind: 'collection', collectionId: selectedCollectionId },
        ratingFilter: { kind: rating },
        tagIds: url.searchParams.getAll('tagIds'),
        tagMatch: url.searchParams.get('tagMatch') ?? 'all',
        areaKeys,
        taxonomyKeys,
      },
      collections: [...collections.values()].map((collection) => ({
        collectionId: collection.collectionId,
        name: collection.name,
        description: collection.description,
        visibility: 'private',
        publicationId: null,
        placeCount: collection.placeIds.length,
        collectionRevision: revision(collection),
        updatedAt: timestamp,
      })),
      places: items.map((placeId) => ({
        placeId,
        overlay: {
          isFavorited: true,
          collectionCount: [...collections.values()].filter((collection) => collection.placeIds.includes(placeId)).length,
          personalRating: placeId === ramenPlaceId ? 4.5 : null,
        },
        place: places[placeId as keyof typeof places],
      })),
      availableFilters: {
        coverage: {
          favoritePlaceCount: 2,
          sampledPlaceCount: 2,
          projectedPlaceCount: 2,
          complete: true,
        },
        areas: [
          { key: seongsuAreaKey, label: '서울 성동구 성수동', count: 1 },
          { key: uenoAreaKey, label: '도쿄 우에노', count: 1 },
        ],
        taxonomies: [
          { key: 'ramen.shoyu', label: '쇼유라멘', count: 1 },
          { key: 'attraction.museum', label: '박물관', count: 1 },
        ],
      },
    })
  }

  await page.route('**/api/library/workspace?*', workspace)
  await page.route('**/api/library/tags?*', (route) => json(route, {
    schemaVersion: 'library-tag-list.v1',
    items: [{ tagId: ramenTagId, name: '진한 국물', placeCount: 1, createdAt: timestamp }],
  }))
  await page.route('**/api/library/map?*', (route) => {
    const url = new URL(route.request().url())
    const collectionId = url.searchParams.get('collectionId') ?? ''
    const collection = collections.get(collectionId)
    const located = (collection?.placeIds ?? []).filter((placeId) => places[placeId as keyof typeof places].location !== null)
    return json(route, {
      schemaVersion: 'library-map-projection.v1',
      scope: { kind: 'collection', collectionId },
      viewport: {
        bounds: {
          west: Number(url.searchParams.get('west')),
          south: Number(url.searchParams.get('south')),
          east: Number(url.searchParams.get('east')),
          north: Number(url.searchParams.get('north')),
        },
        zoom: Number(url.searchParams.get('zoom')),
      },
      features: located.map((placeId) => ({
        kind: 'place',
        placeId,
        label: places[placeId as keyof typeof places].name,
        location: places[placeId as keyof typeof places].location,
      })),
      coverage: {
        representedPlaceCount: located.length,
        unprojectedPlaceCount: (collection?.placeIds.length ?? 0) - located.length,
        complete: located.length === (collection?.placeIds.length ?? 0),
      },
    })
  })
  await page.route('**/api/library/places/*/filing?*', (route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').at(-2)!
    return json(route, {
      schemaVersion: 'place-filing.v2',
      placeId,
      overlay: {
        isFavorited: [...collections.values()].some((collection) => collection.placeIds.includes(placeId)),
        collectionCount: [...collections.values()].filter((collection) => collection.placeIds.includes(placeId)).length,
        personalRating: placeId === ramenPlaceId ? 4.5 : null,
      },
      collections: [...collections.values()].map((collection) => ({
        collectionId: collection.collectionId,
        name: collection.name,
        included: collection.placeIds.includes(placeId),
        collectionRevision: revision(collection),
      })),
    })
  })
  await page.route('**/api/library/filing-commands', async (route) => {
    const command = route.request().postDataJSON() as PlaceFilingCommandRequestV2
    filingCommands.push(command)
    if (conflictPending) {
      conflictPending = false
      for (const collection of collections.values()) collection.revision += 1
      return json(route, {
        schemaVersion: 'place-filing-command-result.v2',
        outcome: 'rejected',
        commandId: command.commandId,
        rejection: { code: 'version-conflict' },
      }, 409)
    }
    const replayed = applied.has(command.commandId)
    if (!replayed) {
      for (const change of command.changes) {
        const collection = collections.get(change.collectionId)
        if (collection === undefined) continue
        collection.placeIds = change.desired === 'included'
          ? [...new Set([...collection.placeIds, command.placeId])]
          : collection.placeIds.filter((placeId) => placeId !== command.placeId)
        collection.revision += 1
      }
      applied.add(command.commandId)
    }
    if (responseLossPending) {
      responseLossPending = false
      return json(route, problem(503, 'PLACE_LIBRARY_UNAVAILABLE'), 503)
    }
    const matching = [...collections.values()].filter((collection) => collection.placeIds.includes(command.placeId))
    return json(route, {
      schemaVersion: 'place-filing-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId: command.commandId, status: replayed ? 'replayed' : 'applied' },
      placeId: command.placeId,
      overlay: {
        isFavorited: matching.length > 0,
        collectionCount: matching.length,
        personalRating: command.placeId === ramenPlaceId ? 4.5 : null,
      },
      collections: command.changes.map((change) => ({
        collectionId: change.collectionId,
        included: collections.get(change.collectionId)?.placeIds.includes(command.placeId) ?? false,
        collectionRevision: revision(collections.get(change.collectionId)!),
      })),
    }, replayed ? 200 : 201)
  })
  await page.route('**/api/library/collection-commands', async (route) => {
    const command = route.request().postDataJSON() as CollectionLifecycleCommandRequestV2
    lifecycleCommands.push(command)
    if (command.kind === 'create') {
      collections.set(command.collectionId, {
        collectionId: command.collectionId,
        name: command.name,
        description: command.description,
        placeIds: [],
        revision: 1,
      })
    } else if (command.kind === 'update') {
      const collection = collections.get(command.collectionId)!
      if (command.name !== undefined) collection.name = command.name
      if (command.description !== undefined) collection.description = command.description
      collection.revision += 1
    } else {
      collections.delete(command.collectionId)
    }
    const collection = command.kind === 'delete' ? null : collections.get(command.collectionId)!
    return json(route, {
      schemaVersion: 'collection-lifecycle-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId: command.commandId, status: 'applied' },
      collection: collection === null ? null : {
        collectionId: collection.collectionId,
        name: collection.name,
        description: collection.description,
        visibility: 'private',
        publicationId: null,
        placeCount: collection.placeIds.length,
        collectionRevision: revision(collection),
        updatedAt: timestamp,
      },
    }, 201)
  })
  await page.route(/\/api\/places\/[^/]+$/, (route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').at(-1)!
    const place = places[placeId as keyof typeof places]
    return json(route, {
      schemaVersion: 'place-detail.v1',
      requestedPlaceId: placeId,
      placeId,
      redirectedFrom: [],
      status: 'available',
      ...place,
      personalState: {
        saved: false,
        wanted: false,
        personalRating: placeId === ramenPlaceId ? 4.5 : null,
        preferencesUpdatedAt: timestamp,
        visits: { visited: false, count: 0 },
      },
    })
  })
  await page.route('**/api/library/places/*/organization?*', (route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').at(-2)!
    return json(route, {
      schemaVersion: 'library-place-organization.v1',
      placeId,
      items: [{
        kind: 'tag', tagId: ramenTagId, name: '진한 국물', selected: placeId === ramenPlaceId,
      }],
    })
  })
  await page.route('**/api/places/*/visits?*', (route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').at(-2)!
    return json(route, { schemaVersion: 'visit-history.v1', placeId, items: [] })
  })
  await page.route('**/api/writing?*', (route) => {
    const url = new URL(route.request().url())
    return json(route, {
      schemaVersion: 'writing-list.v2',
      filter: { kind: 'note', placeId: url.searchParams.get('placeId') },
      items: [],
    })
  })

  return { collections, filingCommands, lifecycleCommands }
}

async function openRamenDetail(page: Page) {
  await page.getByRole('button', { name: /서울 라멘/ }).first().click()
  await page.getByRole('button', { name: /멘야 하루 쇼유라멘/ }).click()
  await expect(page.getByRole('complementary', { name: '선택한 장소 상세' })).toBeVisible()
}

test('uses Collection membership as the favorite truth and keeps unlocated Places in the list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop Collection workspace coverage')
  await installCollectionLibraryFixture(page)
  await page.goto('/library')

  await expect(page.getByRole('heading', { name: '내 카테고리' })).toBeVisible()
  await expect(page.getByRole('button', { name: /서울 라멘/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /도쿄 여행/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '서울 성동구 성수동', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '쇼유라멘', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('저장됨')
  await expect(page.locator('body')).not.toContainText('가고 싶음')

  await page.getByRole('button', { name: /도쿄 여행/ }).first().click()
  await expect(page.getByRole('button', { name: /도쿄 새 박물관/ })).toBeVisible()
})

test('files one Place into multiple Collections atomically without changing its Rating', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop atomic filing coverage')
  const fixture = await installCollectionLibraryFixture(page)
  await page.goto('/library')
  await openRamenDetail(page)

  const filing = page.getByRole('region', { name: '내 카테고리' })
  await expect(page.getByRole('region', { name: '내 평점' }).getByLabel('0.1–5.0')).toHaveValue('4.5')
  await filing.getByLabel(/서울 라멘/).uncheck()
  await filing.getByLabel(/도쿄 여행/).check()
  await filing.getByRole('button', { name: '변경 저장' }).click()
  await expect(filing.getByRole('status').filter({ hasText: '내 카테고리를 저장했습니다.' })).toBeVisible()

  expect(fixture.filingCommands).toHaveLength(1)
  expect(fixture.filingCommands[0]?.changes).toHaveLength(2)
  expect(fixture.filingCommands[0]).not.toHaveProperty('personalRating')
  expect(fixture.collections.get(ramenCollectionId)?.placeIds).not.toContain(ramenPlaceId)
  expect(fixture.collections.get(tokyoCollectionId)?.placeIds).toContain(ramenPlaceId)
})

test('preserves a filing draft on revision conflict', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop conflict recovery coverage')
  const fixture = await installCollectionLibraryFixture(page, { conflictOnce: true })
  await page.goto('/library')
  await openRamenDetail(page)

  const filing = page.getByRole('region', { name: '내 카테고리' })
  const tokyo = filing.getByLabel(/도쿄 여행/)
  await tokyo.check()
  await filing.getByRole('button', { name: '변경 저장' }).click()
  await expect(filing.getByRole('status').filter({ hasText: '선택은 유지했으니' })).toBeVisible()
  await expect(tokyo).toBeChecked()

  await filing.getByRole('button', { name: '변경 저장' }).click()
  await expect(filing.getByRole('status').filter({ hasText: '내 카테고리를 저장했습니다.' })).toBeVisible()
  expect(fixture.filingCommands).toHaveLength(2)
  expect(fixture.filingCommands[0]?.commandId).not.toBe(fixture.filingCommands[1]?.commandId)
})

test('retries a response-lost filing with the exact same command', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop idempotent retry coverage')
  const fixture = await installCollectionLibraryFixture(page, { responseLossOnce: true })
  await page.goto('/library')
  await openRamenDetail(page)

  const filing = page.getByRole('region', { name: '내 카테고리' })
  await filing.getByLabel(/도쿄 여행/).check()
  await filing.getByRole('button', { name: '변경 저장' }).click()
  await expect(filing.getByRole('alert')).toContainText('같은 요청으로 다시 확인')
  await filing.getByRole('button', { name: '다시 시도' }).click()
  await expect(filing.getByRole('status').filter({ hasText: '이전 요청 결과를 확인했습니다.' })).toBeVisible()

  expect(fixture.filingCommands).toHaveLength(2)
  expect(fixture.filingCommands[0]).toEqual(fixture.filingCommands[1])
})

test('creates, renames, and deletes a Collection through revision-based commands', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop Collection lifecycle coverage')
  const fixture = await installCollectionLibraryFixture(page)
  await page.goto('/library')

  await page.getByLabel('카테고리 이름').first().fill('비 오는 날')
  await page.getByRole('button', { name: '추가' }).click()
  await expect(page.getByRole('button', { name: /비 오는 날/ })).toBeVisible()

  await page.getByLabel('카테고리 이름 수정').fill('우산 들고 갈 곳')
  await page.getByRole('button', { name: '수정' }).click()
  await expect(page.getByRole('button', { name: /우산 들고 갈 곳/ })).toBeVisible()

  await page.getByRole('button', { name: '카테고리 삭제' }).click()
  await page.getByRole('button', { name: '삭제 확인' }).click()
  await expect(page.getByRole('button', { name: /우산 들고 갈 곳/ })).toHaveCount(0)
  expect(fixture.lifecycleCommands.map((command) => command.kind)).toEqual(['create', 'update', 'delete'])
})

test('switches mobile Collection, list, map, and detail surfaces without losing selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile Collection workspace coverage')
  await installCollectionLibraryFixture(page)
  await page.goto('/library')

  await page.getByRole('button', { name: '카테고리', exact: true }).click()
  await page.getByRole('button', { name: /서울 라멘/ }).first().click()
  await page.getByRole('button', { name: /멘야 하루/ }).click()
  await expect(page.getByRole('complementary', { name: '선택한 장소 상세' })).toBeVisible()
  await page.getByRole('button', { name: '← 목록으로' }).click()
  await page.getByRole('button', { name: '지도', exact: true }).click()
  await expect(page.getByRole('region', { name: '내 장소 지도' })).toBeVisible()
  await page.getByRole('button', { name: '목록', exact: true }).click()
  await expect(page.getByRole('button', { name: /멘야 하루/ })).toBeVisible()
})

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
  manyTaxonomies?: boolean
}>

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function revision(collection: Collection) {
  return `collection-revision.v1.${collection.collectionId}.${collection.revision}`
}

function summarizeCollection(collection: Collection) {
  return { collectionId: collection.collectionId, name: collection.name, description: collection.description,
    visibility: 'private', publicationId: null, placeCount: collection.placeIds.length,
    collectionRevision: revision(collection), updatedAt: timestamp }
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
    const collectionQuery = url.searchParams.get('collectionQuery') ?? ''
    const placeQuery = url.searchParams.get('placeQuery') ?? ''
    const selected = selectedCollectionId === null
      ? [...new Set([...collections.values()].flatMap((collection) => collection.placeIds))]
      : collections.get(selectedCollectionId)?.placeIds ?? []
    const items = selected.filter((placeId) => {
      const place = places[placeId as keyof typeof places]
      if (place === undefined) return false
      if (placeQuery.split(/\s+/).some((term) => !`${place.name} ${place.areaLabel} ${place.primaryTaxonomy.label}`.includes(term))) return false
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
        ...(placeQuery ? { placeQuery } : {}),
        ...(collectionQuery ? { collectionQuery } : {}),
      },
      collections: [...collections.values()].filter((collection) => collection.name.includes(collectionQuery)).map(summarizeCollection),
      ...(url.searchParams.get('includeSelectedCollection') === 'true' && selectedCollectionId !== null && collections.has(selectedCollectionId)
        ? { selectedCollection: summarizeCollection(collections.get(selectedCollectionId)!) } : {}),
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
          ...(options.manyTaxonomies ? Array.from({ length: 38 }, (_, index) => ({
            key: `fixture.type.${index}`, label: `테스트 분류 ${index + 1}`, count: 1,
          })) : []),
        ],
      },
    })
  }

  await page.route('**/api/library/workspace?*', workspace)
  await page.route('**/api/library/tags?*', (route) => json(route, {
    schemaVersion: 'library-tag-list.v1',
    items: [{ tagId: ramenTagId, name: '진한 국물', placeCount: 1, createdAt: timestamp }],
  }))
  await page.route('**/api/library/workspace/map?*', (route) => {
    const url = new URL(route.request().url())
    const collectionId = url.searchParams.get('collectionId')
    const collection = collectionId === null ? undefined : collections.get(collectionId)
    const selectedIds = collectionId === null ? [...new Set([...collections.values()].flatMap((item) => item.placeIds))] : collection?.placeIds ?? []
    const taxonomyKeys = url.searchParams.getAll('taxonomyKeys')
    const areaKeys = url.searchParams.getAll('areaKeys')
    const placeQuery = url.searchParams.get('placeQuery') ?? ''
    const rating = url.searchParams.get('rating') ?? 'any'
    const located = selectedIds.filter((placeId) => {
      const place = places[placeId as keyof typeof places]
      return place.location !== null && rating !== 'unrated' &&
        (areaKeys.length === 0 || areaKeys.includes(seongsuAreaKey)) &&
        (taxonomyKeys.length === 0 || taxonomyKeys.some((key) => place.taxonomyKeys.includes(key as never))) &&
        placeQuery.split(/\s+/).every((term) => `${place.name} ${place.areaLabel} ${place.primaryTaxonomy.label}`.includes(term))
    })
    return json(route, {
      schemaVersion: 'personal-library-map.v2',
      filter: { favoriteScope: collectionId === null ? { kind: 'all' } : { kind: 'collection', collectionId }, ratingFilter: { kind: rating },
        tagIds: url.searchParams.getAll('tagIds'), tagMatch: url.searchParams.get('tagMatch') ?? 'all',
        areaKeys, taxonomyKeys, ...(placeQuery ? { placeQuery } : {}),
      },
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
        unprojectedPlaceCount: selectedIds.filter((id) => places[id as keyof typeof places].location === null).length,
        complete: selectedIds.every((id) => places[id as keyof typeof places].location !== null),
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

  await expect(page.getByRole('heading', { name: '내 목록', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /서울 라멘/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /도쿄 여행/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /멘야 하루 쇼유라멘/ })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '쇼유라멘', exact: true })).not.toBeVisible()
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

  await page.getByRole('button', { name: '＋ 목록 만들기' }).click()
  await page.getByLabel('카테고리 이름', { exact: true }).fill('비 오는 날')
  await page.getByRole('button', { name: '카테고리 만들기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '비 오는 날', exact: true })).toBeVisible()
  await page.getByText('카테고리 관리', { exact: true }).click()

  await page.getByLabel('카테고리 이름 수정').fill('우산 들고 갈 곳')
  await page.getByRole('button', { name: '수정' }).click()
  await expect(page.getByRole('heading', { name: '우산 들고 갈 곳', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '카테고리 삭제' }).click()
  await page.getByRole('button', { name: '삭제 확인' }).click()
  await expect(page.getByRole('button', { name: /우산 들고 갈 곳/ })).toHaveCount(0)
  expect(fixture.lifecycleCommands.map((command) => command.kind)).toEqual(['create', 'update', 'delete'])
})

test('switches mobile Collection, list, map, and detail surfaces without losing selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile Collection workspace coverage')
  await installCollectionLibraryFixture(page)
  await page.goto('/library')

  await page.getByRole('button', { name: /서울 라멘/ }).first().click()
  await page.getByRole('button', { name: /멘야 하루 쇼유라멘/ }).click()
  await expect(page.getByRole('complementary', { name: '선택한 장소 상세' })).toBeVisible()
  await page.getByRole('button', { name: '← 장소 목록으로' }).click()
  await page.getByRole('button', { name: '작업 패널 접고 지도 보기' }).click()
  await expect(page.getByRole('region', { name: '내 장소 지도' })).toBeVisible()
  await page.getByRole('button', { name: '작업 패널 펼치기' }).click()
  await expect(page.getByRole('button', { name: /멘야 하루 쇼유라멘/ })).toBeVisible()
})

test('uses compact single-surface Library layout without clipping at tablet widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'tablet-width Library layout coverage')
  await installCollectionLibraryFixture(page)

  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/library')
    await expect(page.getByRole('heading', { name: '내 목록', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /서울 라멘/ }).first().click()
    await expect(page.getByRole('button', { name: /멘야 하루 쇼유라멘/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('keeps directory, scoped search, bounded filters, detail, and map in one reversible panel', async ({ page }, testInfo) => {
  await installCollectionLibraryFixture(page, { manyTaxonomies: true })
  await page.goto('/library')
  const directorySearch = page.getByRole('search', { name: '내 목록 검색', exact: true })
  await directorySearch.getByRole('searchbox').fill('라멘')
  await directorySearch.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('button', { name: /도쿄 여행/ })).not.toBeVisible()
  await page.getByRole('button', { name: /서울 라멘/ }).click()
  const placeSearch = page.getByRole('search', { name: '선택한 목록 안에서 장소 검색' })
  await placeSearch.getByRole('searchbox').fill('성수동 라멘')
  const mapRequest = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === '/api/library/workspace/map' && url.searchParams.get('placeQuery') === '성수동 라멘'
  })
  await placeSearch.getByRole('button', { name: '검색', exact: true }).click()
  expect(new URL((await mapRequest).url()).searchParams.get('collectionId')).toBe(ramenCollectionId)
  await page.getByRole('button', { name: '필터', exact: true }).click()
  await page.getByRole('button', { name: /장소·음식 분류/ }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(12)
  await page.getByRole('searchbox', { name: '제공된 분류 후보에서 검색' }).fill('쇼유')
  await expect(page.getByRole('checkbox')).toHaveCount(1)
  await page.getByRole('checkbox', { name: /쇼유라멘/ }).check()
  await expect(page.getByText('분류 정보는 일부일 수 있어요', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('library-filter.png') })
  await page.getByRole('button', { name: '장소 보기', exact: true }).click()
  await expect(placeSearch.getByRole('searchbox')).toHaveValue('성수동 라멘')
  const place = page.getByRole('button', { name: /멘야 하루 쇼유라멘/ })
  await place.click()
  const detail = page.getByRole('complementary', { name: '선택한 장소 상세' })
  await expect(detail).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('library-detail.png') })
  await expect(page.getByRole('region', { name: '내 장소 지도' })).toBeVisible()
  await expect(placeSearch).not.toBeVisible()
  await page.getByRole('button', { name: '작업 패널 접고 지도 보기' }).click()
  await expect(detail).not.toBeVisible()
  await page.getByRole('button', { name: '작업 패널 펼치기' }).click()
  await expect(detail).toBeVisible()
  await page.getByRole('button', { name: '← 장소 목록으로' }).click()
  await expect(place).toBeFocused()
  await expect(placeSearch.getByRole('searchbox')).toHaveValue('성수동 라멘')
  await expect(page.getByRole('button', { name: '쇼유라멘 필터 해제' })).toBeVisible()
  await page.getByRole('button', { name: '← 내 목록', exact: true }).click()
  await expect(directorySearch.getByRole('searchbox')).toHaveValue('라멘')
  await expect(page.getByRole('button', { name: /서울 라멘/ })).toBeFocused()
})

test('captures directory and selected single-panel layouts at the four design widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'one screenshot set covers all design widths')
  await installCollectionLibraryFixture(page)
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [360, 800]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/library')
    await expect(page.getByRole('button', { name: /서울 라멘/ })).toBeVisible()
    await expect(page.getByText('지도를 불러오는 중입니다.', { exact: true })).not.toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`library-directory-${width}.png`) })
    await page.getByRole('button', { name: /서울 라멘/ }).click()
    await expect(page.getByRole('button', { name: /멘야 하루 쇼유라멘/ })).toBeVisible()
    const map = page.getByRole('region', { name: '내 장소 지도' })
    const panelBox = await page.locator('#library-work-panel').boundingBox()
    const mapBox = await map.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(mapBox).not.toBeNull()
    expect(mapBox!.height).toBeGreaterThan(160)
    if (width > 720) expect(mapBox!.width).toBeGreaterThan(width / 2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`library-places-${width}.png`) })
    await page.getByRole('button', { name: '작업 패널 접고 지도 보기' }).click()
    const expandedMap = await map.boundingBox()
    expect(width > 720 ? expandedMap!.width : expandedMap!.height).toBeGreaterThan(width > 720 ? mapBox!.width : mapBox!.height)
    await page.screenshot({ path: testInfo.outputPath(`library-map-${width}.png`) })
  }
})

test('opens all saved-place search only through an explicit directory action', async ({ page }) => {
  await installCollectionLibraryFixture(page)
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: '전체 저장 장소', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: '모든 목록의 장소 검색', exact: true }).click()
  await expect(page.getByRole('heading', { name: '전체 저장 장소', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /멘야 하루 쇼유라멘/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /도쿄 새 박물관/ })).toBeVisible()
  await page.getByRole('searchbox', { name: '내 모든 목록 안에서 장소 검색' }).fill('성수동 라멘')
  const request = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === '/api/library/workspace/map' && url.searchParams.get('placeQuery') === '성수동 라멘'
  })
  await page.getByRole('searchbox', { name: '내 모든 목록 안에서 장소 검색' }).press('Enter')
  expect(new URL((await request).url()).searchParams.has('collectionId')).toBe(false)
  await expect(page.getByRole('button', { name: /도쿄 새 박물관/ })).not.toBeVisible()
  await page.getByRole('button', { name: '← 내 목록', exact: true }).click()
  await expect(page.getByRole('heading', { name: '내 목록', exact: true })).toBeVisible()
})

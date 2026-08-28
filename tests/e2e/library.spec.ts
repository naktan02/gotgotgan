import { expect, test, type Page, type Route } from '@playwright/test'
import type { LibraryCommandRequest } from '@place/contracts/http'

const ramenPlaceId = '01992d20-7000-7000-8000-000000000101'
const cafePlaceId = '01992d20-7000-7000-8000-000000000102'
const ramenTagId = '01992d20-7000-7000-8000-000000000201'
const shoyuTagId = '01992d20-7000-7000-8000-000000000202'
const seongsuCollectionId = '01992d20-7000-7000-8000-000000000301'
const timestamp = '2026-08-28T00:00:00.000Z'
const seongsuAreaKey = 'area_abcdefghijklmnopqrstuv'
const seoulForestAreaKey = 'area_vutsrqponmlkjihgfedcba'

type FixturePreference = Readonly<{
  saved: boolean
  wanted: boolean
  personalRating: number | null
  updatedAt: string
}>

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function place(placeId: string, name: string, areaLabel: string, taxonomy: string) {
  return {
    placeId,
    name,
    areaLabel,
    location: placeId === ramenPlaceId
      ? { latitude: 37.5447, longitude: 127.0557 }
      : { latitude: 37.5461, longitude: 127.0492 },
    primaryTaxonomy: { key: taxonomy.toLowerCase(), label: taxonomy },
    taxonomyKeys: [taxonomy.toLowerCase()],
    evidence: { status: 'verified', projectedAt: timestamp },
  }
}

const ramen = place(ramenPlaceId, '멘야 하루', '서울 성동구 성수동', '쇼유라멘')
const cafe = place(cafePlaceId, '서울숲 로스터스', '서울 성동구 서울숲', '카페')

async function installLibraryFixture(
  page: Page,
  options: Readonly<{
    preferenceConflictOnce?: boolean
    preferenceFailureOnce?: boolean
  }> = {},
) {
  let collectionSelected = true
  let ramenTagSelected = true
  let shoyuTagSelected = false
  let preferenceRevision = 0
  let preferenceConflictPending = options.preferenceConflictOnce ?? false
  let preferenceFailurePending = options.preferenceFailureOnce ?? false
  const appliedPreferenceCommandIds = new Set<string>()
  const preferences: Record<string, FixturePreference> = {
    [ramenPlaceId]: {
      saved: true, wanted: false, personalRating: 4.5, updatedAt: timestamp,
    },
    [cafePlaceId]: {
      saved: true, wanted: false, personalRating: null, updatedAt: timestamp,
    },
  }
  const commands: LibraryCommandRequest[] = []
  await page.route('**/api/library/place-facets', (route) => json(route, {
    schemaVersion: 'library-place-facets.v1',
    sourceState: 'saved',
    coverage: { savedPlaceCount: 2, sampledPlaceCount: 2, projectedPlaceCount: 2, complete: true },
    areas: [
      { key: seongsuAreaKey, label: '서울 성동구 성수동', count: 1 },
      { key: seoulForestAreaKey, label: '서울 성동구 서울숲', count: 1 },
    ],
    taxonomies: [
      { key: '쇼유라멘', label: '쇼유라멘', count: 1 },
      { key: '카페', label: '카페', count: 1 },
    ],
  }))
  await page.route('**/api/library/tags?*', (route) => json(route, {
    schemaVersion: 'library-tag-list.v1',
    items: [
      { tagId: ramenTagId, name: '라면', placeCount: 1, createdAt: timestamp },
      { tagId: shoyuTagId, name: '쇼유라멘', placeCount: 1, createdAt: timestamp },
    ],
  }))
  await page.route('**/api/library/collections?*', (route) => json(route, {
    schemaVersion: 'library-collection-list.v1',
    items: [{
      collectionId: seongsuCollectionId,
      name: '성수동',
      description: '성수동에서 다시 가볼 곳',
      visibility: 'private',
      publicationId: null,
      placeCount: 2,
      updatedAt: timestamp,
    }],
  }))
  await page.route(`**/api/library/collections/${seongsuCollectionId}?*`, (route) => json(route, {
    schemaVersion: 'library-collection-detail.v1',
    collection: {
      collectionId: seongsuCollectionId,
      name: '성수동',
      description: '성수동에서 다시 가볼 곳',
      visibility: 'private',
      publicationId: null,
      placeCount: 2,
      updatedAt: timestamp,
    },
    places: [
      { placeId: ramenPlaceId, position: 0, addedAt: timestamp, place: ramen },
      { placeId: cafePlaceId, position: 1, addedAt: timestamp, place: cafe },
    ],
  }))
  await page.route('**/api/library/places?*', (route) => {
    const url = new URL(route.request().url())
    const selectedTags = url.searchParams.getAll('tagIds')
    const selectedAreas = url.searchParams.getAll('areaKeys')
    const selectedTaxonomies = url.searchParams.getAll('taxonomyKeys')
    const state = url.searchParams.get('state') ?? 'saved'
    const allItems = [{
          placeId: ramenPlaceId,
          ...preferences[ramenPlaceId],
          place: ramen,
        }, {
          placeId: cafePlaceId,
          ...preferences[cafePlaceId],
          place: cafe,
        }]
    const items = allItems.filter((item) => (
      (state === 'saved' ? item.saved : state === 'wanted' ? item.wanted : item.personalRating !== null) &&
      (selectedTags.length === 0 || (
        selectedTags.includes(ramenTagId) && item.placeId === ramenPlaceId
      )) &&
      (selectedAreas.length === 0 || (
        selectedAreas.includes(item.placeId === ramenPlaceId ? seongsuAreaKey : seoulForestAreaKey)
      )) &&
      (selectedTaxonomies.length === 0 || selectedTaxonomies.includes(
        item.place.primaryTaxonomy.key,
      ))
    ))
    return json(route, {
      schemaVersion: 'library-place-list.v3',
      filter: {
        state,
        tagIds: [...selectedTags].sort(),
        tagMatch: url.searchParams.get('tagMatch') ?? 'all',
        areaKeys: [...selectedAreas].sort(),
        taxonomyKeys: [...selectedTaxonomies].sort(),
      },
      items,
    })
  })
  await page.route('**/api/library/places/*/organization?*', (route) => json(route, {
    schemaVersion: 'library-place-organization.v1',
    placeId: route.request().url().includes(ramenPlaceId) ? ramenPlaceId : cafePlaceId,
    items: [{
      kind: 'collection',
      collectionId: seongsuCollectionId,
      name: '성수동',
      selected: collectionSelected,
      position: collectionSelected ? 0 : null,
    }, {
      kind: 'tag', tagId: ramenTagId, name: '라면', selected: ramenTagSelected,
    }, {
      kind: 'tag', tagId: shoyuTagId, name: '쇼유라멘', selected: shoyuTagSelected,
    }],
  }))
  await page.route('**/api/library/commands', async (route) => {
    const body = route.request().postDataJSON() as LibraryCommandRequest
    commands.push(body)
    if (body.command.kind === 'remove-collection-place') collectionSelected = false
    if (body.command.kind === 'add-collection-place') collectionSelected = true
    if (body.command.kind === 'untag-place' && body.command.tagId === ramenTagId) ramenTagSelected = false
    if (body.command.kind === 'tag-place' && body.command.tagId === ramenTagId) ramenTagSelected = true
    if (body.command.kind === 'untag-place' && body.command.tagId === shoyuTagId) shoyuTagSelected = false
    if (body.command.kind === 'tag-place' && body.command.tagId === shoyuTagId) shoyuTagSelected = true
    if (body.command.kind === 'set-place-preferences') {
      if (appliedPreferenceCommandIds.has(body.commandId)) {
        return json(route, { schemaVersion: 'library-command-result.v1', status: 'replayed' })
      }
      const current = preferences[body.command.placeId]
      if (current === undefined) return json(route, {}, 404)
      if (preferenceConflictPending) {
        preferenceConflictPending = false
        preferences[body.command.placeId] = {
          ...current,
          updatedAt: new Date(Date.parse(timestamp) + 9_000).toISOString(),
        }
        return json(route, {
          type: 'urn:place:error:library-preference-version-conflict',
          title: 'Place preferences changed after they were read',
          status: 409,
          code: 'PLACE_LIBRARY_PREFERENCE_VERSION_CONFLICT',
          retryable: true,
          correlationRef: 'e2e-preference-conflict',
        }, 409)
      }
      if (current.updatedAt !== body.command.expectedUpdatedAt) {
        return json(route, {
          type: 'urn:place:error:library-preference-version-conflict',
          title: 'Place preferences changed after they were read',
          status: 409,
          code: 'PLACE_LIBRARY_PREFERENCE_VERSION_CONFLICT',
          retryable: true,
          correlationRef: 'e2e-preference-conflict',
        }, 409)
      }
      preferenceRevision += 1
      preferences[body.command.placeId] = {
        saved: body.command.saved,
        wanted: body.command.wanted,
        personalRating: body.command.personalRating,
        updatedAt: new Date(Date.parse(timestamp) + preferenceRevision * 1_000).toISOString(),
      }
      appliedPreferenceCommandIds.add(body.commandId)
      if (preferenceFailurePending) {
        preferenceFailurePending = false
        return json(route, {
          type: 'urn:place:error:library-unavailable',
          title: 'Library is temporarily unavailable',
          status: 503,
          code: 'PLACE_LIBRARY_UNAVAILABLE',
          retryable: true,
          correlationRef: 'e2e-preference-response-loss',
        }, 503)
      }
    }
    return json(route, { schemaVersion: 'library-command-result.v1', status: 'applied' }, 201)
  })
  await page.route('**/api/places/*', (route) => {
    const selected = route.request().url().includes(ramenPlaceId) ? ramen : cafe
    const preference = preferences[selected.placeId]!
    return json(route, {
      schemaVersion: 'place-detail.v1',
      status: 'available',
      requestedPlaceId: selected.placeId,
      redirectedFrom: [],
      ...selected,
      personalState: {
        saved: preference.saved,
        wanted: preference.wanted,
        personalRating: preference.personalRating,
        preferencesUpdatedAt: preference.updatedAt,
        visits: selected.placeId === ramenPlaceId
          ? { visited: true, count: 2, firstVisitedAt: timestamp, lastVisitedAt: timestamp }
          : { visited: false, count: 0 },
      },
    })
  })
  return commands
}

test('browses saved Places by tags and Collection without leaking the Backend boundary', async ({ page }) => {
  await installLibraryFixture(page)
  await page.goto('/library')

  const tagFilters = page.getByLabel('태그 필터')
  await expect(page.getByRole('heading', { name: '내 장소' })).toBeVisible()
  await expect(page.getByRole('link', { name: '내 장소' })).toHaveAttribute('aria-current', 'page')
  await expect(tagFilters.getByRole('button', { name: /^라면/ })).toBeVisible()
  await expect(page.getByText('멘야 하루', { exact: true }).first()).toBeVisible()
  await expect(page.getByLabel('내 평점')).toHaveValue('4.5')

  const areaFilters = page.getByLabel('저장 장소 지역 필터')
  await areaFilters.getByRole('button', { name: /^서울 성동구 성수동/ }).click()
  await expect(areaFilters.getByRole('button', { name: /^서울 성동구 성수동/ }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('서울숲 로스터스', { exact: true })).toHaveCount(0)
  await areaFilters.getByRole('button', { name: /^서울 성동구 성수동/ }).click()

  const taxonomyFilters = page.getByLabel('저장 장소 분류 필터')
  await taxonomyFilters.getByRole('button', { name: /^쇼유라멘/ }).click()
  await expect(page.getByText('서울숲 로스터스', { exact: true })).toHaveCount(0)
  await taxonomyFilters.getByRole('button', { name: /^쇼유라멘/ }).click()

  await tagFilters.getByRole('button', { name: /^라면/ }).click()
  await expect(tagFilters.getByRole('button', { name: /^라면/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('서울숲 로스터스', { exact: true })).toHaveCount(0)

  await tagFilters.getByRole('button', { name: /^쇼유라멘/ }).click()
  await page.getByRole('button', { name: '하나 이상' }).click()
  await expect(page.getByRole('button', { name: '하나 이상' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '성수동 2' }).click()
  await expect(page.getByText('서울숲 로스터스', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '성수동 2' })).toHaveAttribute('aria-current', 'page')
})

test('shows a login action when the opaque browser session is absent', async ({ page }) => {
  await page.route('**/api/library/**', (route) => json(route, {
    type: 'urn:place:error:authentication-required',
    title: 'Authentication required',
    status: 401,
    code: 'PLACE_AUTHENTICATION_REQUIRED',
    retryable: false,
    correlationRef: 'e2e-auth-required',
  }, 401))

  await page.goto('/library')

  await expect(page.getByRole('heading', { name: '내 장소를 보려면 로그인이 필요합니다.' })).toBeVisible()
  await expect(page.getByRole('link', { name: '로그인하고 계속' })).toHaveAttribute('href', '/api/auth/oidc/start')
})

test('updates saved, wanted, and Personal Rating with observed preference versions', async ({ page }) => {
  const commands = await installLibraryFixture(page)
  await page.goto('/library')

  const preferences = page.getByRole('region', { name: '내 상태' })
  const wanted = preferences.getByRole('button', { name: /가고 싶음/ })
  await wanted.click()
  await expect(wanted).toHaveAttribute('aria-pressed', 'true')

  await preferences.getByLabel('내 평점').fill('4.8')
  await preferences.getByRole('button', { name: '평점 저장' }).click()
  await expect(preferences.getByLabel('내 평점')).toHaveValue('4.8')

  const saved = preferences.getByRole('button', { name: /^저장/ })
  await saved.click()
  await expect(page.getByRole('region', { name: '장소 목록' })
    .getByText('멘야 하루', { exact: true })).toHaveCount(0)

  const preferenceCommands = commands.filter((value) => (
    value.command.kind === 'set-place-preferences'
  ))
  expect(preferenceCommands).toHaveLength(3)
  expect(preferenceCommands.map((value) => value.command)).toEqual([
    expect.objectContaining({
      expectedUpdatedAt: timestamp,
      saved: true, wanted: true, personalRating: 4.5,
    }),
    expect.objectContaining({
      expectedUpdatedAt: '2026-08-28T00:00:01.000Z',
      saved: true, wanted: true, personalRating: 4.8,
    }),
    expect.objectContaining({
      expectedUpdatedAt: '2026-08-28T00:00:02.000Z',
      saved: false, wanted: true, personalRating: 4.8,
    }),
  ])
})

test('refreshes a stale Place preference instead of overwriting it', async ({ page }) => {
  await installLibraryFixture(page, { preferenceConflictOnce: true })
  await page.goto('/library')

  const preferences = page.getByRole('region', { name: '내 상태' })
  const wanted = preferences.getByRole('button', { name: /가고 싶음/ })
  await wanted.click()

  await expect(preferences.getByRole('alert')).toContainText(
    '다른 곳에서 상태가 변경되어 최신 값을 불러왔습니다.',
  )
  await expect(wanted).toHaveAttribute('aria-pressed', 'false')
})

test('retries a response-lost preference command with the same command ID', async ({ page }) => {
  const commands = await installLibraryFixture(page, { preferenceFailureOnce: true })
  await page.goto('/library')

  const preferences = page.getByRole('region', { name: '내 상태' })
  const wanted = preferences.getByRole('button', { name: /가고 싶음/ })
  await wanted.click()
  await expect(preferences.getByRole('alert')).toContainText('내 상태를 저장하지 못했습니다.')
  await preferences.getByRole('button', { name: '다시 시도' }).click()
  await expect(wanted).toHaveAttribute('aria-pressed', 'true')

  const preferenceCommands = commands.filter((value) => (
    value.command.kind === 'set-place-preferences'
  ))
  expect(preferenceCommands).toHaveLength(2)
  expect(preferenceCommands[0]?.commandId).toBe(preferenceCommands[1]?.commandId)
})

test('organizes a Place with only the member saved Collections and Tags', async ({ page }) => {
  const commands = await installLibraryFixture(page)
  await page.goto('/library')

  const organization = page.getByRole('region', { name: '내 분류' })
  await expect(organization.getByText('내가 저장하거나 가져온 컬렉션과 태그만 표시됩니다.')).toBeVisible()
  await expect(organization.getByRole('button', { name: '성수동 포함됨' }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(organization.getByRole('button', { name: '쇼유라멘 추가' }))
    .toHaveAttribute('aria-pressed', 'false')

  await organization.getByRole('button', { name: '쇼유라멘 추가' }).click()
  await expect(organization.getByRole('button', { name: '쇼유라멘 포함됨' }))
    .toHaveAttribute('aria-pressed', 'true')
  await organization.getByRole('button', { name: '성수동 포함됨' }).click()
  await expect(organization.getByRole('button', { name: '성수동 추가' }))
    .toHaveAttribute('aria-pressed', 'false')

  expect(commands).toHaveLength(2)
  expect(commands).toEqual(expect.arrayContaining([
    expect.objectContaining({
      command: { kind: 'tag-place', tagId: shoyuTagId, placeId: ramenPlaceId },
    }),
    expect.objectContaining({
      command: {
        kind: 'remove-collection-place',
        collectionId: seongsuCollectionId,
        placeId: ramenPlaceId,
      },
    }),
  ]))
})

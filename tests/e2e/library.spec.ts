import { expect, test, type Page, type Route } from '@playwright/test'
import type {
  BrowserPrivateNoteCommandRequest,
  BrowserVisitRecordRequest,
  LibraryCommandRequest,
} from '@place/contracts/http'

const ramenPlaceId = '01992d20-7000-7000-8000-000000000101'
const cafePlaceId = '01992d20-7000-7000-8000-000000000102'
const ramenTagId = '01992d20-7000-7000-8000-000000000201'
const shoyuTagId = '01992d20-7000-7000-8000-000000000202'
const seongsuCollectionId = '01992d20-7000-7000-8000-000000000301'
const firstNoteId = '01992d20-7000-7000-8000-000000000501'
const secondNoteId = '01992d20-7000-7000-8000-000000000502'
const timestamp = '2026-08-28T00:00:00.000Z'
const seongsuAreaKey = 'area_abcdefghijklmnopqrstuv'
const seoulForestAreaKey = 'area_vutsrqponmlkjihgfedcba'

type FixturePreference = Readonly<{
  saved: boolean
  wanted: boolean
  personalRating: number | null
  updatedAt: string
}>

type FixtureCollection = {
  collectionId: string
  name: string
  description: string | null
  placeIds: string[]
  updatedAt: string
}

type FixtureTag = {
  tagId: string
  name: string
  placeIds: Set<string>
  createdAt: string
}

type FixtureVisit = BrowserVisitRecordRequest & Readonly<{ recordedAt: string }>
type FixtureNote = {
  documentId: string
  placeId: string
  body: string
  version: number
  createdAt: string
  updatedAt: string
}

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
    managementFailureOnce?: boolean
    visitFailureOnce?: boolean
    paginatedVisits?: boolean
    writingFailureOnce?: boolean
    writingConflictOnce?: boolean
    paginatedNotes?: boolean
  }> = {},
) {
  let preferenceRevision = 0
  let preferenceConflictPending = options.preferenceConflictOnce ?? false
  let preferenceFailurePending = options.preferenceFailureOnce ?? false
  let managementFailurePending = options.managementFailureOnce ?? false
  let visitFailurePending = options.visitFailureOnce ?? false
  let writingFailurePending = options.writingFailureOnce ?? false
  let writingConflictPending = options.writingConflictOnce ?? false
  const appliedCommandIds = new Set<string>()
  const appliedVisitFingerprints = new Map<string, string>()
  const appliedWritingFingerprints = new Map<string, string>()
  const collections = new Map<string, FixtureCollection>([[seongsuCollectionId, {
    collectionId: seongsuCollectionId,
    name: '성수동',
    description: '성수동에서 다시 가볼 곳',
    placeIds: [ramenPlaceId, cafePlaceId],
    updatedAt: timestamp,
  }]])
  const tags = new Map<string, FixtureTag>([
    [ramenTagId, {
      tagId: ramenTagId, name: '라면', placeIds: new Set([ramenPlaceId]), createdAt: timestamp,
    }],
    [shoyuTagId, {
      tagId: shoyuTagId, name: '쇼유라멘', placeIds: new Set([cafePlaceId]), createdAt: timestamp,
    }],
  ])
  const preferences: Record<string, FixturePreference> = {
    [ramenPlaceId]: {
      saved: true, wanted: false, personalRating: 4.5, updatedAt: timestamp,
    },
    [cafePlaceId]: {
      saved: true, wanted: false, personalRating: null, updatedAt: timestamp,
    },
  }
  const visits = new Map<string, FixtureVisit[]>([
    [ramenPlaceId, [{
      id: '01992d20-7000-7000-8000-000000000401',
      placeId: ramenPlaceId,
      visitedAt: timestamp,
      recordedAt: '2026-08-28T00:05:00.000Z',
    }, {
      id: '01992d20-7000-7000-8000-000000000402',
      placeId: ramenPlaceId,
      visitedAt: '2026-08-27T03:00:00.000Z',
      recordedAt: '2026-08-27T03:10:00.000Z',
    }]],
    [cafePlaceId, []],
  ])
  const notes = new Map<string, FixtureNote>([
    [firstNoteId, {
      documentId: firstNoteId,
      placeId: ramenPlaceId,
      body: '국물이 깔끔하고 면 익힘이 좋았다.',
      version: 1,
      createdAt: '2026-08-27T01:00:00.000Z',
      updatedAt: '2026-08-29T01:00:00.000Z',
    }],
    [secondNoteId, {
      documentId: secondNoteId,
      placeId: ramenPlaceId,
      body: '다음에는 매운 토핑을 추가해 보기.',
      version: 1,
      createdAt: '2026-08-26T01:00:00.000Z',
      updatedAt: '2026-08-28T01:00:00.000Z',
    }],
  ])
  const commands: LibraryCommandRequest[] = []
  const visitRequests: BrowserVisitRecordRequest[] = []
  const writingRequests: BrowserPrivateNoteCommandRequest[] = []
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
    items: [...tags.values()].map((tag) => ({
      tagId: tag.tagId,
      name: tag.name,
      placeCount: tag.placeIds.size,
      createdAt: tag.createdAt,
    })),
  }))
  await page.route('**/api/library/collections?*', (route) => json(route, {
    schemaVersion: 'library-collection-list.v1',
    items: [...collections.values()].map((collection) => ({
      collectionId: collection.collectionId,
      name: collection.name,
      description: collection.description,
      visibility: 'private',
      publicationId: null,
      placeCount: collection.placeIds.length,
      updatedAt: collection.updatedAt,
    })),
  }))
  await page.route('**/api/library/collections/*?*', (route) => {
    const collectionId = new URL(route.request().url()).pathname.split('/').at(-1)!
    const collection = collections.get(collectionId)
    if (collection === undefined) return json(route, {}, 404)
    return json(route, {
      schemaVersion: 'library-collection-detail.v1',
      collection: {
        collectionId: collection.collectionId,
        name: collection.name,
        description: collection.description,
        visibility: 'private',
        publicationId: null,
        placeCount: collection.placeIds.length,
        updatedAt: collection.updatedAt,
      },
      places: collection.placeIds.map((placeId, position) => ({
        placeId,
        position,
        addedAt: timestamp,
        place: placeId === ramenPlaceId ? ramen : cafe,
      })),
    })
  })
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
  await page.route('**/api/library/places/*/organization?*', (route) => {
    const placeId = route.request().url().includes(ramenPlaceId) ? ramenPlaceId : cafePlaceId
    return json(route, {
      schemaVersion: 'library-place-organization.v1',
      placeId,
      items: [
        ...[...collections.values()].map((collection) => {
          const position = collection.placeIds.indexOf(placeId)
          return {
            kind: 'collection' as const,
            collectionId: collection.collectionId,
            name: collection.name,
            selected: position >= 0,
            position: position >= 0 ? position : null,
          }
        }),
        ...[...tags.values()].map((tag) => ({
          kind: 'tag' as const,
          tagId: tag.tagId,
          name: tag.name,
          selected: tag.placeIds.has(placeId),
        })),
      ],
    })
  })
  await page.route('**/api/library/commands', async (route) => {
    const body = route.request().postDataJSON() as LibraryCommandRequest
    commands.push(body)
    if (appliedCommandIds.has(body.commandId)) {
      return json(route, { schemaVersion: 'library-command-result.v1', status: 'replayed' })
    }
    if (body.command.kind === 'set-place-preferences') {
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
      appliedCommandIds.add(body.commandId)
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
    } else if (body.command.kind === 'create-collection') {
      collections.set(body.command.collectionId, {
        collectionId: body.command.collectionId,
        name: body.command.name,
        description: body.command.description ?? null,
        placeIds: [],
        updatedAt: timestamp,
      })
    } else if (body.command.kind === 'rename-collection') {
      const collection = collections.get(body.command.collectionId)
      if (collection !== undefined) collection.name = body.command.name
    } else if (body.command.kind === 'delete-collection') {
      collections.delete(body.command.collectionId)
    } else if (body.command.kind === 'add-collection-place') {
      const collection = collections.get(body.command.collectionId)
      if (collection !== undefined && !collection.placeIds.includes(body.command.placeId)) {
        collection.placeIds.splice(body.command.position ?? collection.placeIds.length, 0, body.command.placeId)
      }
    } else if (body.command.kind === 'remove-collection-place') {
      const collection = collections.get(body.command.collectionId)
      if (collection !== undefined) {
        collection.placeIds = collection.placeIds.filter((placeId) => placeId !== body.command.placeId)
      }
    } else if (body.command.kind === 'move-collection-place') {
      const collection = collections.get(body.command.collectionId)
      const current = collection?.placeIds.indexOf(body.command.placeId) ?? -1
      if (collection !== undefined && current >= 0) {
        const [placeId] = collection.placeIds.splice(current, 1)
        collection.placeIds.splice(body.command.position, 0, placeId!)
      }
    } else if (body.command.kind === 'create-tag') {
      tags.set(body.command.tagId, {
        tagId: body.command.tagId,
        name: body.command.name,
        placeIds: new Set(),
        createdAt: timestamp,
      })
    } else if (body.command.kind === 'rename-tag') {
      const tag = tags.get(body.command.tagId)
      if (tag !== undefined) tag.name = body.command.name
    } else if (body.command.kind === 'delete-tag') {
      tags.delete(body.command.tagId)
    } else if (body.command.kind === 'tag-place') {
      tags.get(body.command.tagId)?.placeIds.add(body.command.placeId)
    } else if (body.command.kind === 'untag-place') {
      tags.get(body.command.tagId)?.placeIds.delete(body.command.placeId)
    }
    if (body.command.kind !== 'set-place-preferences') {
      appliedCommandIds.add(body.commandId)
    }
    if (managementFailurePending && body.command.kind === 'create-collection') {
      managementFailurePending = false
      return json(route, {
        type: 'urn:place:error:library-unavailable',
        title: 'Library is temporarily unavailable',
        status: 503,
        code: 'PLACE_LIBRARY_UNAVAILABLE',
        retryable: true,
        correlationRef: 'e2e-management-response-loss',
      }, 503)
    }
    return json(route, { schemaVersion: 'library-command-result.v1', status: 'applied' }, 201)
  })
  await page.route(/\/api\/places\/[^/]+$/, (route) => {
    const selected = route.request().url().includes(ramenPlaceId) ? ramen : cafe
    const preference = preferences[selected.placeId]!
    const placeVisits = visits.get(selected.placeId) ?? []
    const visitedTimes = placeVisits.map((visit) => visit.visitedAt).sort()
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
        visits: placeVisits.length === 0
          ? { visited: false, count: 0 }
          : {
              visited: true,
              count: placeVisits.length,
              firstVisitedAt: visitedTimes[0],
              lastVisitedAt: visitedTimes.at(-1),
            },
      },
    })
  })
  await page.route('**/api/places/*/visits?*', (route) => {
    const url = new URL(route.request().url())
    const placeId = url.pathname.split('/').at(-2)!
    const placeVisits = visits.get(placeId) ?? []
    const cursor = url.searchParams.get('cursor')
    const items = options.paginatedVisits
      ? cursor === null ? placeVisits.slice(0, 1) : placeVisits.slice(1)
      : placeVisits
    return json(route, {
      schemaVersion: 'visit-history.v1',
      placeId,
      items: items.map((visit) => ({
        visitId: visit.id,
        visitedAt: visit.visitedAt,
        recordedAt: visit.recordedAt,
      })),
      ...(options.paginatedVisits && cursor === null && placeVisits.length > 1
        ? { nextCursor: 'visit-page-2' }
        : {}),
    })
  })
  await page.route('**/api/visits', (route) => {
    const body = route.request().postDataJSON() as BrowserVisitRecordRequest
    visitRequests.push(body)
    const fingerprint = JSON.stringify(body)
    const appliedFingerprint = appliedVisitFingerprints.get(body.id)
    if (appliedFingerprint !== undefined) {
      return appliedFingerprint === fingerprint
        ? json(route, { schemaVersion: 'visit-record-result.v1', status: 'recorded' }, 201)
        : json(route, {
            type: 'urn:place:error:visit-conflict',
            title: 'Visit conflicts with an earlier record',
            status: 409,
            code: 'PLACE_VISIT_CONFLICT',
            retryable: true,
            correlationRef: 'e2e-visit-conflict',
          }, 409)
    }
    const placeVisits = visits.get(body.placeId) ?? []
    visits.set(body.placeId, [{
      ...body,
      recordedAt: '2026-08-28T14:30:00.000Z',
    }, ...placeVisits].sort((left, right) => right.visitedAt.localeCompare(left.visitedAt)))
    appliedVisitFingerprints.set(body.id, fingerprint)
    if (visitFailurePending) {
      visitFailurePending = false
      return json(route, {
        type: 'urn:place:error:visit-unavailable',
        title: 'Visits are temporarily unavailable',
        status: 503,
        code: 'PLACE_VISIT_UNAVAILABLE',
        retryable: true,
        correlationRef: 'e2e-visit-response-loss',
      }, 503)
    }
    return json(route, { schemaVersion: 'visit-record-result.v1', status: 'recorded' }, 201)
  })
  await page.route('**/api/writing?*', (route) => {
    const url = new URL(route.request().url())
    const placeId = url.searchParams.get('placeId')!
    const cursor = url.searchParams.get('cursor')
    const placeNotes = [...notes.values()]
      .filter((note) => note.placeId === placeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const items = options.paginatedNotes
      ? cursor === null ? placeNotes.slice(0, 1) : placeNotes.slice(1)
      : placeNotes
    return json(route, {
      schemaVersion: 'writing-list.v2',
      filter: { kind: 'note', placeId },
      items: items.map((note) => ({
        documentId: note.documentId,
        kind: 'note',
        title: null,
        bodyPreview: note.body.slice(0, 280),
        bodyTruncated: note.body.length > 280,
        visibility: 'private',
        publicationId: null,
        version: note.version,
        placeIds: [note.placeId],
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      ...(options.paginatedNotes && cursor === null && placeNotes.length > 1
        ? { nextCursor: 'note-page-2' }
        : {}),
    })
  })
  await page.route(/\/api\/writing\/[0-9a-f-]+$/, (route) => {
    const documentId = new URL(route.request().url()).pathname.split('/').at(-1)!
    const note = notes.get(documentId)
    if (note === undefined) return json(route, {
      type: 'urn:place:error:writing-not-found',
      title: 'Writing not found',
      status: 404,
      code: 'PLACE_WRITING_NOT_FOUND',
      retryable: false,
      correlationRef: 'e2e-writing-not-found',
    }, 404)
    return json(route, {
      schemaVersion: 'writing-detail.v1',
      document: {
        documentId: note.documentId,
        kind: 'note',
        title: null,
        body: note.body,
        visibility: 'private',
        publicationId: null,
        version: note.version,
        placeIds: [note.placeId],
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    })
  })
  await page.route('**/api/writing/commands', (route) => {
    const body = route.request().postDataJSON() as BrowserPrivateNoteCommandRequest
    writingRequests.push(body)
    const fingerprint = JSON.stringify(body)
    const prior = appliedWritingFingerprints.get(body.commandId)
    if (prior !== undefined) {
      return prior === fingerprint
        ? json(route, { schemaVersion: 'writing-command-result.v1', status: 'replayed' })
        : json(route, {
            type: 'urn:place:error:writing-command-conflict',
            title: 'Writing command conflicts with an earlier request',
            status: 409,
            code: 'PLACE_WRITING_COMMAND_CONFLICT',
            retryable: true,
            correlationRef: 'e2e-writing-command-conflict',
          }, 409)
    }
    if (body.command.kind === 'update-note' && writingConflictPending) {
      writingConflictPending = false
      const current = notes.get(body.command.documentId)!
      notes.set(current.documentId, {
        ...current,
        body: '다른 기기에서 저장한 최신 메모',
        version: current.version + 1,
        updatedAt: '2026-08-29T02:00:00.000Z',
      })
      return json(route, {
        type: 'urn:place:error:writing-version-conflict',
        title: 'Writing changed concurrently',
        status: 409,
        code: 'PLACE_WRITING_VERSION_CONFLICT',
        retryable: true,
        correlationRef: 'e2e-writing-version-conflict',
      }, 409)
    }
    let version: number
    if (body.command.kind === 'create-note') {
      version = 1
      notes.set(body.command.documentId, {
        documentId: body.command.documentId,
        placeId: body.command.placeId,
        body: body.command.body,
        version,
        createdAt: '2026-08-29T03:00:00.000Z',
        updatedAt: '2026-08-29T03:00:00.000Z',
      })
    } else {
      const current = notes.get(body.command.documentId)
      if (current === undefined || current.version !== body.command.expectedVersion) {
        return json(route, {
          type: 'urn:place:error:writing-version-conflict',
          title: 'Writing changed concurrently',
          status: 409,
          code: 'PLACE_WRITING_VERSION_CONFLICT',
          retryable: true,
          correlationRef: 'e2e-writing-version-conflict',
        }, 409)
      }
      version = current.version + 1
      notes.set(current.documentId, {
        ...current,
        body: body.command.body,
        version,
        updatedAt: '2026-08-29T03:00:00.000Z',
      })
    }
    appliedWritingFingerprints.set(body.commandId, fingerprint)
    if (writingFailurePending) {
      writingFailurePending = false
      return json(route, {
        type: 'urn:place:error:writing-unavailable',
        title: 'Writing is temporarily unavailable',
        status: 503,
        code: 'PLACE_WRITING_UNAVAILABLE',
        retryable: true,
        correlationRef: 'e2e-writing-response-loss',
      }, 503)
    }
    return json(route, {
      schemaVersion: 'writing-command-result.v1',
      status: 'applied',
      documentId: body.command.documentId,
      version,
    }, 201)
  })
  return { commands, visitRequests, writingRequests }
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
  const { commands } = await installLibraryFixture(page)
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
  const { commands } = await installLibraryFixture(page, { preferenceFailureOnce: true })
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

test('manages Place-owned Collections, Tags, and ordered memberships', async ({ page }) => {
  const { commands } = await installLibraryFixture(page)
  await page.goto('/library')
  await page.getByRole('button', { name: '목록·태그 관리' }).click()

  await expect(page.getByText('NAVER·Google·Kakao의 원본 저장 목록이나 즐겨찾기는')).toBeVisible()
  const collectionManager = page.getByRole('region', { name: '컬렉션' })
  await collectionManager.getByLabel('새 컬렉션 이름').fill('을지로 라멘')
  await collectionManager.getByRole('button', { name: '만들기' }).click()
  await expect(collectionManager.getByRole('button', { name: /을지로 라멘/ })).toBeVisible()
  await collectionManager.getByRole('button', { name: '컬렉션 삭제' }).click()
  await collectionManager.getByRole('button', { name: '삭제 확인' }).click()
  await expect(collectionManager.getByRole('button', { name: /을지로 라멘/ })).toHaveCount(0)

  await collectionManager.getByRole('button', { name: /성수동/ }).click()
  await collectionManager.getByLabel('컬렉션 이름', { exact: true }).fill('성수 라멘')
  await collectionManager.getByRole('button', { name: '이름 변경' }).click()
  await expect(collectionManager.getByRole('button', { name: /성수 라멘/ })).toBeVisible()
  await collectionManager.getByRole('button', { name: '서울숲 로스터스 위로 이동' }).click()
  await expect(collectionManager.locator('ol > li').first()).toContainText('서울숲 로스터스')
  await collectionManager.getByRole('button', { name: '멘야 하루 컬렉션에서 제거' }).click()
  await expect(collectionManager.getByText('멘야 하루', { exact: true })).toHaveCount(0)

  const tagManager = page.getByRole('region', { name: '태그' })
  await tagManager.getByLabel('새 태그 이름').fill('혼밥')
  await tagManager.getByRole('button', { name: '만들기' }).click()
  await expect(tagManager.getByRole('button', { name: /혼밥/ })).toBeVisible()
  await tagManager.getByRole('button', { name: /라면/ }).click()
  await tagManager.getByLabel('태그 이름', { exact: true }).fill('라멘 전문점')
  await tagManager.getByRole('button', { name: '이름 변경' }).click()
  await expect(tagManager.getByRole('button', { name: /라멘 전문점/ })).toBeVisible()
  await tagManager.getByRole('button', { name: '태그 삭제' }).click()
  await tagManager.getByRole('button', { name: '삭제 확인' }).click()
  await expect(tagManager.getByRole('button', { name: /라멘 전문점/ })).toHaveCount(0)

  await page.getByRole('button', { name: '장소 보기' }).click()
  const collectionNavigation = page.getByLabel('내 컬렉션')
  await collectionNavigation.getByRole('button', { name: /성수 라멘/ }).click()
  const placeList = page.getByRole('region', { name: '장소 목록' })
  await expect(placeList.getByText('서울숲 로스터스', { exact: true })).toBeVisible()
  await expect(placeList.getByText('멘야 하루', { exact: true })).toHaveCount(0)

  expect(commands.map((value) => value.command.kind)).toEqual(expect.arrayContaining([
    'create-collection',
    'delete-collection',
    'rename-collection',
    'move-collection-place',
    'remove-collection-place',
    'create-tag',
    'rename-tag',
    'delete-tag',
  ]))
})

test('retries a response-lost management command with the same command ID', async ({ page }) => {
  const { commands } = await installLibraryFixture(page, { managementFailureOnce: true })
  await page.goto('/library')
  await page.getByRole('button', { name: '목록·태그 관리' }).click()

  const collectionManager = page.getByRole('region', { name: '컬렉션' })
  await collectionManager.getByLabel('새 컬렉션 이름').fill('응답 유실 복구')
  await collectionManager.getByRole('button', { name: '만들기' }).click()
  await expect(page.getByText('컬렉션을 만들지 못했습니다.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '같은 요청 다시 시도' }).click()
  await expect(collectionManager.getByRole('button', { name: /응답 유실 복구/ })).toBeVisible()

  const createCommands = commands.filter((value) => value.command.kind === 'create-collection')
  expect(createCommands).toHaveLength(2)
  expect(createCommands[0]?.commandId).toBe(createCommands[1]?.commandId)
  expect(createCommands[0]?.command).toEqual(createCommands[1]?.command)
})

test('records repeated immutable Visits and reads bounded history', async ({ page }) => {
  const { visitRequests } = await installLibraryFixture(page, { paginatedVisits: true })
  await page.goto('/library')

  const visitRegion = page.getByRole('region', { name: '방문 기록' })
  await expect(visitRegion.getByText(/총 2회/)).toBeVisible()
  await expect(visitRegion.locator('ol > li')).toHaveCount(1)
  await visitRegion.getByRole('button', { name: '이전 방문 더 보기' }).click()
  await expect(visitRegion.locator('ol > li')).toHaveCount(2)

  await visitRegion.getByLabel('방문한 시각').fill('2026-08-27T08:30')
  await visitRegion.getByRole('button', { name: '방문 추가' }).click()

  await expect(visitRegion.getByRole('status')).toHaveText('방문 기록을 추가했습니다.')
  await expect(visitRegion.getByText(/총 3회/)).toBeVisible()
  expect(visitRequests).toHaveLength(1)
  expect(visitRequests[0]).toMatchObject({ placeId: ramenPlaceId })
  expect(visitRequests[0]).not.toHaveProperty('memberId')
  expect(visitRequests[0]).not.toHaveProperty('evidence')
})

test('retries a response-lost Visit with the same immutable request', async ({ page }) => {
  const { visitRequests } = await installLibraryFixture(page, { visitFailureOnce: true })
  await page.goto('/library')

  const visitRegion = page.getByRole('region', { name: '방문 기록' })
  await visitRegion.getByLabel('방문한 시각').fill('2026-08-26T19:10')
  await visitRegion.getByRole('button', { name: '방문 추가' }).click()
  await expect(visitRegion.getByRole('alert')).toContainText('방문 기록 결과를 확인하지 못했습니다.')
  await visitRegion.getByRole('button', { name: '같은 기록 다시 확인' }).click()

  await expect(visitRegion.getByRole('status')).toHaveText('방문 기록을 추가했습니다.')
  await expect(visitRegion.getByText(/총 3회/)).toBeVisible()
  expect(visitRequests).toHaveLength(2)
  expect(visitRequests[0]).toEqual(visitRequests[1])
})

test('creates and edits private Place Notes through bounded Writing pages', async ({ page }) => {
  const { writingRequests } = await installLibraryFixture(page, { paginatedNotes: true })
  await page.goto('/library')

  const notes = page.getByRole('region', { name: '내 메모' })
  await expect(notes.locator('ol > li')).toHaveCount(1)
  await notes.getByRole('button', { name: '메모 더 보기' }).click()
  await expect(notes.locator('ol > li')).toHaveCount(2)

  await notes.getByRole('button', { name: /국물이 깔끔하고/ }).click()
  const editor = notes.getByLabel('메모 편집')
  await expect(editor).toHaveValue('국물이 깔끔하고 면 익힘이 좋았다.')
  await expect(notes.getByText(/작성 2026\. 8\. 27\..*수정 2026\. 8\. 29\./)).toBeVisible()
  await editor.fill('국물이 깔끔하고 면 익힘이 아주 좋았다.')
  await notes.getByRole('button', { name: '메모 저장' }).click()
  await expect(notes.getByRole('status')).toHaveText('메모를 저장했습니다.')

  await notes.getByRole('button', { name: '새 메모' }).click()
  await notes.getByLabel('새 비공개 메모').fill('주말에는 대기가 길다.')
  await notes.getByRole('button', { name: '메모 저장' }).click()
  await expect(notes.getByRole('status')).toHaveText('비공개 메모를 만들었습니다.')

  expect(writingRequests).toHaveLength(2)
  expect(writingRequests[0]?.command.kind).toBe('update-note')
  expect(writingRequests[1]?.command.kind).toBe('create-note')
  expect(writingRequests.every((request) => (
    !('memberId' in request) &&
    !('visibility' in request.command) &&
    !('publicationId' in request.command)
  ))).toBe(true)
})

test('retries a response-lost private Note with the exact command', async ({ page }) => {
  const { writingRequests } = await installLibraryFixture(page, { writingFailureOnce: true })
  await page.goto('/library')

  const notes = page.getByRole('region', { name: '내 메모' })
  await notes.getByLabel('새 비공개 메모').fill('응답 유실에도 한 번만 저장할 메모')
  await notes.getByRole('button', { name: '메모 저장' }).click()
  await expect(notes.getByRole('alert')).toContainText('메모 저장 결과를 확인하지 못했습니다.')
  await notes.getByRole('button', { name: '같은 저장 다시 확인' }).click()

  await expect(notes.getByRole('status')).toHaveText('비공개 메모를 만들었습니다.')
  expect(writingRequests).toHaveLength(2)
  expect(writingRequests[0]).toEqual(writingRequests[1])
})

test('preserves a Note draft on optimistic version conflict', async ({ page }) => {
  const { writingRequests } = await installLibraryFixture(page, { writingConflictOnce: true })
  await page.goto('/library')

  const notes = page.getByRole('region', { name: '내 메모' })
  await notes.getByRole('button', { name: /국물이 깔끔하고/ }).click()
  const editor = notes.getByLabel('메모 편집')
  await editor.fill('내가 작성 중인 충돌 초안')
  await notes.getByRole('button', { name: '메모 저장' }).click()

  await expect(notes.getByRole('alert')).toContainText('현재 초안은 덮어쓰지 않았습니다.')
  await expect(editor).toHaveValue('내가 작성 중인 충돌 초안')
  await notes.getByRole('button', { name: '최신 내용 불러오기' }).click()
  await expect(editor).toHaveValue('다른 기기에서 저장한 최신 메모')
  expect(writingRequests).toHaveLength(1)
})

test('organizes a Place with only the member saved Collections and Tags', async ({ page }) => {
  const { commands } = await installLibraryFixture(page)
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

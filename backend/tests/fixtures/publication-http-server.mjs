import { createServer } from 'node:http'

const host = process.env.PLACE_E2E_BACKEND_HOST
const port = Number(process.env.PLACE_E2E_BACKEND_PORT)
if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('E2E Place backend address is invalid')
}

const collectionPublicationId = '01992d20-0000-7000-8000-000000000001'
const writingPublicationId = '01992d20-0000-7000-8000-000000000002'
const placeId = '01992d20-0000-7000-8000-000000000003'
const pendingPlaceId = '01992d20-0000-7000-8000-000000000004'
const secondPagePlaceId = '01992d20-0000-7000-8000-000000000055'
const publicCollectionPlaces = [{
  placeId,
  position: 0,
  place: {
    placeId,
    name: '조용한 라멘 연구소',
    areaLabel: '서울 성동구 성수동',
    location: { latitude: 37.5445, longitude: 127.056 },
    primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
    taxonomyKeys: ['food.noodle.ramen'],
    evidence: { status: 'verified', projectedAt: '2026-08-26T10:00:00.000Z' },
  },
}, ...Array.from({ length: 49 }, (_, index) => ({
  placeId: index === 0
    ? pendingPlaceId
    : `01992d20-0000-7000-8000-${String(index + 4).padStart(12, '0')}`,
  position: index + 1,
  place: null,
})), {
  placeId: secondPagePlaceId,
  position: 50,
  place: {
    placeId: secondPagePlaceId,
    name: '두 번째 페이지 카페',
    areaLabel: '서울 성동구 서울숲',
    location: { latitude: 37.548, longitude: 127.05 },
    primaryTaxonomy: { key: 'drink.coffee', label: '카페' },
    taxonomyKeys: ['drink.coffee'],
    evidence: { status: 'verified', projectedAt: '2026-08-26T10:00:00.000Z' },
  },
}]
const projections = new Map([
  [`/v1/public/writing/${writingPublicationId}`, {
    schemaVersion: 'place-published-writing.v1',
    kind: 'entry',
    publicationId: writingPublicationId,
    visibility: 'public',
    title: '성수의 하루',
    body: '공개하기로 선택한 글만 표시합니다.',
    placeIds: [placeId],
    updatedAt: '2026-08-26T10:00:00.000Z',
  }],
])

const taxonomy = {
  schemaVersion: 'place-taxonomy.v1',
  nodes: [
    { key: 'food.noodle.ramen', parentKey: null, label: '라멘', kind: 'category', version: 1 },
    { key: 'drink.coffee', parentKey: null, label: '카페', kind: 'category', version: 1 },
    { key: 'culture.exhibition', parentKey: null, label: '전시', kind: 'category', version: 1 },
  ],
}

const searchItems = [
  {
    placeId: '01992d20-0000-7000-8000-000000000101',
    name: '조용한 라멘 연구소', areaLabel: '성수',
    location: { latitude: 37.5445, longitude: 127.056 },
    primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
    taxonomyKeys: ['food.noodle.ramen'], evidenceStatus: 'verified',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000102',
    name: '긴 이름으로 목록의 말줄임과 선택 상태를 확인하는 작은 로스터리 카페', areaLabel: '서울숲',
    location: { latitude: 37.548, longitude: 127.043 },
    primaryTaxonomy: { key: 'drink.coffee', label: '카페' },
    taxonomyKeys: ['drink.coffee'], evidenceStatus: 'unverified',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000103',
    name: '동쪽 기록 보관소', areaLabel: null,
    location: { latitude: 37.553, longitude: 127.132 },
    primaryTaxonomy: { key: 'culture.exhibition', label: '전시' },
    taxonomyKeys: ['culture.exhibition'], evidenceStatus: 'stale',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000104',
    name: '골목 라멘', areaLabel: '뚝섬',
    location: { latitude: 37.541, longitude: 127.062 },
    primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
    taxonomyKeys: ['food.noodle.ramen'], evidenceStatus: 'verified',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000105',
    name: '작업실 카페', areaLabel: '성수',
    location: { latitude: 37.539, longitude: 127.051 },
    primaryTaxonomy: { key: 'drink.coffee', label: '카페' },
    taxonomyKeys: ['drink.coffee'], evidenceStatus: 'verified',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000106',
    name: '저녁 전시실', areaLabel: '건대',
    location: { latitude: 37.535, longitude: 127.079 },
    primaryTaxonomy: { key: 'culture.exhibition', label: '전시' },
    taxonomyKeys: ['culture.exhibition'], evidenceStatus: 'conflicted',
  },
].map(({ placeId: canonicalPlaceId, ...item }) => ({
  resultId: `place:${canonicalPlaceId}`,
  identity: { kind: 'canonical', placeId: canonicalPlaceId },
  source: { key: 'local', label: '내 장소', detailsAvailable: false, attributions: [] },
  freshness: { kind: 'indexed', observedAt: '2026-08-26T10:00:00.000Z' },
  ...item,
}))

const providerSearchItem = {
  resultId: 'google:fixture-result',
  identity: {
    kind: 'provider', providerKey: 'google', providerPlaceId: 'google-place-100',
  },
  source: {
    key: 'google', label: 'Google Maps', detailsAvailable: true,
    externalUri: 'https://maps.example.invalid/place/100',
    categoryLabel: '라멘 전문점',
    attributions: [{ label: 'Google Maps' }],
  },
  freshness: { kind: 'live', observedAt: '2026-08-26T10:00:00.000Z' },
  name: '공식 검색 라멘 연구소', areaLabel: '서울 성동구',
  location: { latitude: 37.5445, longitude: 127.056 },
  primaryTaxonomy: null, taxonomyKeys: [], evidenceStatus: 'unverified',
}

const providerDetail = {
  schemaVersion: 'place-provider-detail.v1',
  providerKey: 'google', providerPlaceId: 'google-place-100',
  name: '공식 검색 라멘 연구소', address: '서울 성동구 연무장길 1',
  location: { latitude: 37.5445, longitude: 127.056 },
  categoryLabel: '라멘 전문점',
  externalUri: 'https://maps.example.invalid/place/100',
  phone: '02-000-0000', rating: 4.6, userRatingCount: 120,
  businessStatus: 'OPERATIONAL',
  openingHours: { openNow: true, weekdayDescriptions: ['수요일: 오전 11:00~오후 9:00'] },
  photos: [{ authorAttributions: [{ label: '사진 작성자', uri: 'https://authors.example.invalid/100' }] }],
  attributions: [{ label: 'Google Maps', uri: 'https://maps.example.invalid/place/100' }],
  observedAt: '2026-08-26T10:01:00.000Z',
}

const searchObservations = []
const suggestionObservations = []
const suggestionSelections = []

const suggestionSessionId = '01992d20-6000-7000-8000-000000000001'
const suggestionFixtures = [
  {
    suggestionId: '01992d20-6000-7000-8000-000000000002',
    identity: { kind: 'provider', providerKey: 'google', providerPlaceId: 'google-senkai-fukuoka' },
    source: { key: 'google', label: 'Google Maps', detailsAvailable: true, attributions: [{ label: 'Google Maps' }] },
    name: '센카이 라멘', areaLabel: '후쿠오카 하카타', location: null,
    categoryLabel: '라멘 전문점', observedAt: '2026-08-26T10:00:00.000Z',
  },
  {
    suggestionId: '01992d20-6000-7000-8000-000000000003',
    identity: { kind: 'provider', providerKey: 'kakao', providerPlaceId: 'kakao-senkai-tokyo' },
    source: { key: 'kakao', label: 'Kakao Local', detailsAvailable: false, attributions: [{ label: 'Kakao Local' }] },
    name: '센카이 라멘', areaLabel: '도쿄 신주쿠', location: { latitude: 35.6938, longitude: 139.7034 },
    categoryLabel: '일본 음식점', observedAt: '2026-08-26T10:00:00.000Z',
  },
]

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 64 * 1024) reject(new Error('request too large'))
    })
    request.on('end', () => {
      try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, value, contentType = 'application/json') {
  if (response.destroyed || response.writableEnded) return
  response.statusCode = status
  response.setHeader('content-type', contentType)
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(JSON.stringify(value))
}

async function search(request, response) {
  let body
  try { body = await readJson(request) } catch {
    sendJson(response, 400, { code: 'PLACE_SEARCH_REQUEST_INVALID' }, 'application/problem+json')
    return
  }
  const observation = { query: String(body.query ?? ''), aborted: false }
  searchObservations.push(observation)
  response.once('close', () => {
    if (!response.writableEnded) observation.aborted = true
  })
  if (observation.query === '오류') {
    sendJson(response, 503, {
      type: 'urn:place:error:search-unavailable', title: '검색을 잠시 사용할 수 없습니다.',
      status: 503, code: 'PLACE_SEARCH_UNAVAILABLE', retryable: true,
      correlationRef: 'e2e-search-error',
    }, 'application/problem+json')
    return
  }
  if (observation.query === '느린 검색') {
    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  let items = searchItems
  if (observation.query === '공식 결과') items = [providerSearchItem]
  else if (observation.query === '없음') items = []
  else if (observation.query === '카페') items = items.filter((item) => item.taxonomyKeys.includes('drink.coffee'))
  else if (observation.query.includes('라멘')) items = items.filter((item) => item.taxonomyKeys.includes('food.noodle.ramen'))
  if (body.filters?.taxonomyKeys?.length > 0) {
    items = items.filter((item) => item.taxonomyKeys.some((key) => body.filters.taxonomyKeys.includes(key)))
  }
  if (body.bounds) {
    items = items.filter((item) =>
      item.location.longitude >= body.bounds.west && item.location.longitude <= body.bounds.east &&
      item.location.latitude >= body.bounds.south && item.location.latitude <= body.bounds.north)
  }
  const offset = body.cursor === 'fixture-page-2' ? 3 : 0
  const page = items.slice(offset, offset + 3)
  sendJson(response, 200, {
    schemaVersion: 'place-search.v1',
    items: page,
    ...(offset + page.length < items.length ? { nextCursor: 'fixture-page-2' } : {}),
    sources: observation.query === '부분 결과'
      ? [
          { sourceKey: 'local', status: 'complete', resultCount: page.length },
          { sourceKey: 'provider-test', status: 'unavailable', resultCount: 0, errorCode: 'PLACE_SEARCH_SOURCE_UNAVAILABLE' },
        ]
      : [{ sourceKey: 'local', status: 'complete', resultCount: page.length }],
  })
}

async function suggest(request, response) {
  let body
  try { body = await readJson(request) } catch {
    sendJson(response, 400, { code: 'PLACE_SUGGESTION_REQUEST_INVALID' }, 'application/problem+json')
    return
  }
  const query = String(body.query ?? '')
  const observation = { query, aborted: false }
  suggestionObservations.push(observation)
  response.once('close', () => {
    if (!response.writableEnded) observation.aborted = true
  })
  if (query === '센') await new Promise((resolve) => setTimeout(resolve, 900))
  const items = ['센카이', 'senkai', '샌카이'].some((value) => query.includes(value))
    ? suggestionFixtures
    : query === '부분 후보'
      ? suggestionFixtures.slice(0, 1)
      : []
  sendJson(response, 200, {
    schemaVersion: 'place-suggestions.v1',
    sessionId: body.sessionId ?? suggestionSessionId,
    items,
    sources: query === '부분 후보'
      ? [
          { sourceKey: 'local', status: 'complete', resultCount: 0 },
          { sourceKey: 'google', status: 'complete', resultCount: 1 },
          { sourceKey: 'kakao', status: 'unavailable', resultCount: 0, errorCode: 'PLACE_SUGGESTION_SOURCE_UNAVAILABLE' },
        ]
      : [
          { sourceKey: 'local', status: 'complete', resultCount: 0 },
          { sourceKey: 'google', status: 'complete', resultCount: items.length > 0 ? 1 : 0 },
          { sourceKey: 'kakao', status: 'complete', resultCount: items.length > 1 ? 1 : 0 },
        ],
  })
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
  if (request.method === 'POST' && request.url === '/v1/search/places') {
    await search(request, response)
    return
  }
  if (request.method === 'POST' && request.url === '/v1/search/suggestions') {
    await suggest(request, response)
    return
  }
  if (request.method === 'POST' && request.url === '/v1/search/suggestion-selections') {
    let body
    try { body = await readJson(request) } catch {
      sendJson(response, 400, { code: 'PLACE_SUGGESTION_SELECTION_INVALID' }, 'application/problem+json')
      return
    }
    suggestionSelections.push({ suggestionId: body.suggestionId })
    sendJson(response, 200, {
      schemaVersion: 'place-suggestion-selection.v1',
      suggestionId: body.suggestionId,
      status: 'recorded',
      observationId: '01992d20-6000-7000-8000-000000000004',
    })
    return
  }
  if (request.method === 'GET' && request.url === '/v1/taxonomy/nodes') {
    sendJson(response, 200, taxonomy)
    return
  }
  if (request.method === 'POST' && request.url === '/v1/providers/place-details') {
    let body
    try { body = await readJson(request) } catch {
      sendJson(response, 400, { code: 'PLACE_PROVIDER_DETAIL_REQUEST_INVALID' }, 'application/problem+json')
      return
    }
    if (body.providerKey !== 'google' || body.providerPlaceId !== 'google-place-100') {
      sendJson(response, 400, { code: 'PLACE_PROVIDER_DETAIL_UNSUPPORTED' }, 'application/problem+json')
      return
    }
    sendJson(response, 200, providerDetail)
    return
  }
  if (request.method === 'GET' && request.url === '/__test/search-observations') {
    sendJson(response, 200, searchObservations)
    return
  }
  if (request.method === 'GET' && request.url === '/__test/suggestion-observations') {
    sendJson(response, 200, { requests: suggestionObservations, selections: suggestionSelections })
    return
  }
  if (
    request.method === 'GET' &&
    [placeId, secondPagePlaceId].includes(requestUrl.pathname.replace('/v1/places/', '')) &&
    requestUrl.pathname.startsWith('/v1/places/')
  ) {
    if (request.headers.authorization !== undefined) {
      sendJson(response, 400, { code: 'PLACE_PUBLIC_DETAIL_AUTHORITY_FORBIDDEN' }, 'application/problem+json')
      return
    }
    const selectedPlaceId = requestUrl.pathname.replace('/v1/places/', '')
    const selected = publicCollectionPlaces.find((item) => item.placeId === selectedPlaceId)?.place
    sendJson(response, 200, {
      schemaVersion: 'place-detail.v1',
      status: 'available',
      requestedPlaceId: selectedPlaceId,
      placeId: selectedPlaceId,
      redirectedFrom: [],
      ...selected,
    })
    return
  }
  if (
    request.method === 'GET' &&
    requestUrl.pathname === `/v1/public/collections/${collectionPublicationId}/map`
  ) {
    const bounds = {
      west: Number(requestUrl.searchParams.get('west')),
      south: Number(requestUrl.searchParams.get('south')),
      east: Number(requestUrl.searchParams.get('east')),
      north: Number(requestUrl.searchParams.get('north')),
    }
    const features = [{
      kind: 'place', placeId, label: '조용한 라멘 연구소',
      location: { latitude: 37.5445, longitude: 127.056 },
    }, {
      kind: 'place', placeId: secondPagePlaceId, label: '두 번째 페이지 카페',
      location: { latitude: 37.548, longitude: 127.05 },
    }].filter((feature) => (
      feature.location.longitude >= bounds.west && feature.location.longitude <= bounds.east &&
      feature.location.latitude >= bounds.south && feature.location.latitude <= bounds.north
    ))
    sendJson(response, 200, {
      schemaVersion: 'place-published-collection-map.v1',
      publicationId: collectionPublicationId,
      viewport: {
        bounds,
        zoom: Number(requestUrl.searchParams.get('zoom')),
      },
      features,
      coverage: {
        representedPlaceCount: features.length, unprojectedPlaceCount: 49, complete: false,
      },
    })
    return
  }
  if (
    request.method === 'GET' &&
    requestUrl.pathname === `/v1/public/collections/${collectionPublicationId}`
  ) {
    const secondPage = requestUrl.searchParams.get('cursor') === 'public-page-2'
    sendJson(response, 200, {
      schemaVersion: 'place-published-collection.v3',
      publicationId: collectionPublicationId,
      visibility: 'unlisted',
      name: '성수에서 다시 갈 곳',
      description: '링크를 받은 사람에게만 보이는 컬렉션',
      placeCount: publicCollectionPlaces.length,
      places: secondPage ? publicCollectionPlaces.slice(50) : publicCollectionPlaces.slice(0, 50),
      ...(secondPage ? {} : { nextCursor: 'public-page-2' }),
      updatedAt: '2026-08-26T10:00:00.000Z',
    })
    return
  }
  const projection = request.method === 'GET' ? projections.get(request.url ?? '') : undefined
  if (projection === undefined) {
    sendJson(response, 404, { code: 'PLACE_PUBLICATION_NOT_FOUND' })
    return
  }
  sendJson(response, 200, projection)
})

server.listen(port, host)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())

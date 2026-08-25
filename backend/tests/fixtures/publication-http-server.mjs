import { createServer } from 'node:http'

const host = process.env.PLACE_E2E_BACKEND_HOST
const port = Number(process.env.PLACE_E2E_BACKEND_PORT)
if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('E2E Place backend address is invalid')
}

const collectionPublicationId = '01992d20-0000-7000-8000-000000000001'
const writingPublicationId = '01992d20-0000-7000-8000-000000000002'
const placeId = '01992d20-0000-7000-8000-000000000003'
const projections = new Map([
  [`/v1/public/collections/${collectionPublicationId}`, {
    publicationId: collectionPublicationId,
    visibility: 'unlisted',
    name: '성수에서 다시 갈 곳',
    description: '링크를 받은 사람에게만 보이는 컬렉션',
    places: [{ placeId, position: 0 }],
    updatedAt: '2026-08-26T10:00:00.000Z',
  }],
  [`/v1/public/writing/${writingPublicationId}`, {
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
]

const searchObservations = []

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
  if (observation.query === '없음') items = []
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

const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/v1/search/places') {
    await search(request, response)
    return
  }
  if (request.method === 'GET' && request.url === '/v1/taxonomy/nodes') {
    sendJson(response, 200, taxonomy)
    return
  }
  if (request.method === 'GET' && request.url === '/__test/search-observations') {
    sendJson(response, 200, searchObservations)
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

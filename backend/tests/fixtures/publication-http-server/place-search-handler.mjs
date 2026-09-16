import {
  readPublicationRequestJson,
  sendPublicationJson,
} from './publication-http.mjs'

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
].map(({ placeId, ...item }) => ({
  resultId: `place:${placeId}`,
  identity: { kind: 'canonical', placeId },
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

export function createPlaceSearchHandler() {
  const observations = []

  return async function handlePlaceSearch(request, response) {
    if (request.method === 'POST' && request.url === '/v1/search/places') {
      let body
      try { body = await readPublicationRequestJson(request) } catch {
        sendPublicationJson(response, 400, { code: 'PLACE_SEARCH_REQUEST_INVALID' }, 'application/problem+json')
        return true
      }
      const observation = { query: String(body.query ?? ''), aborted: false }
      observations.push(observation)
      response.once('close', () => {
        if (!response.writableEnded) observation.aborted = true
      })
      if (observation.query === '오류') {
        sendPublicationJson(response, 503, {
          type: 'urn:place:error:search-unavailable', title: '검색을 잠시 사용할 수 없습니다.',
          status: 503, code: 'PLACE_SEARCH_UNAVAILABLE', retryable: true,
          correlationRef: 'e2e-search-error',
        }, 'application/problem+json')
        return true
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
      sendPublicationJson(response, 200, {
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
      return true
    }

    if (request.method === 'GET' && request.url === '/v1/taxonomy/nodes') {
      sendPublicationJson(response, 200, taxonomy)
      return true
    }

    if (request.method === 'POST' && request.url === '/v1/providers/place-details') {
      let body
      try { body = await readPublicationRequestJson(request) } catch {
        sendPublicationJson(response, 400, { code: 'PLACE_PROVIDER_DETAIL_REQUEST_INVALID' }, 'application/problem+json')
        return true
      }
      if (body.providerKey !== 'google' || body.providerPlaceId !== 'google-place-100') {
        sendPublicationJson(response, 400, { code: 'PLACE_PROVIDER_DETAIL_UNSUPPORTED' }, 'application/problem+json')
        return true
      }
      sendPublicationJson(response, 200, providerDetail)
      return true
    }

    if (request.method === 'GET' && request.url === '/__test/search-observations') {
      sendPublicationJson(response, 200, observations)
      return true
    }

    return false
  }
}

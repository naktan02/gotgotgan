import {
  readPublicationRequestJson,
  sendPublicationJson,
} from './publication-http.mjs'

const items = [
  {
    placeId: '01992d20-0000-7000-8000-000000000101',
    name: '조용한 라멘 연구소',
    area: {
      label: '서울 성동구 성수동',
      reference: { key: 'area.kr.seoul.seongdong.seongsu', version: 1 },
    },
    location: { latitude: 37.5445, longitude: 127.056 },
    primaryTaxonomy: { key: 'food.noodle.ramen', version: 1, label: '라멘' },
    taxonomyReferences: [{ key: 'food.noodle.ramen', version: 1, kind: 'category' }],
    evidenceStatus: 'verified',
    projectedAt: '2026-08-26T10:00:00.000Z',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000104',
    name: '성수 골목 쇼유라멘',
    area: {
      label: '서울 성동구 성수동',
      reference: { key: 'area.kr.seoul.seongdong.seongsu', version: 1 },
    },
    location: { latitude: 37.541, longitude: 127.062 },
    primaryTaxonomy: { key: 'food.noodle.ramen', version: 1, label: '라멘' },
    taxonomyReferences: [
      { key: 'food.noodle.ramen', version: 1, kind: 'category' },
      { key: 'food.noodle.ramen.shoyu', version: 1, kind: 'attribute' },
    ],
    evidenceStatus: 'verified',
    projectedAt: '2026-08-26T10:00:00.000Z',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000105',
    name: '강남 정통 라멘',
    area: {
      label: '서울 강남구 역삼동',
      reference: { key: 'area.kr.seoul.gangnam.yeoksam', version: 1 },
    },
    location: { latitude: 37.501, longitude: 127.027 },
    primaryTaxonomy: { key: 'food.noodle.ramen', version: 1, label: '라멘' },
    taxonomyReferences: [{ key: 'food.noodle.ramen', version: 1, kind: 'category' }],
    evidenceStatus: 'unverified',
    projectedAt: '2026-08-26T10:00:00.000Z',
  },
  {
    placeId: '01992d20-0000-7000-8000-000000000106',
    name: '성수 작업실 카페',
    area: {
      label: '서울 성동구 성수동',
      reference: { key: 'area.kr.seoul.seongdong.seongsu', version: 1 },
    },
    location: { latitude: 37.539, longitude: 127.051 },
    primaryTaxonomy: { key: 'drink.coffee.cafe', version: 1, label: '카페' },
    taxonomyReferences: [{ key: 'drink.coffee.cafe', version: 1, kind: 'category' }],
    evidenceStatus: 'stale',
    projectedAt: '2026-08-26T10:00:00.000Z',
  },
]

const tokens = {
  seongsu: {
    tokenId: 'area:area.kr.seoul.seongdong.seongsu@1', kind: 'area',
    key: 'area.kr.seoul.seongdong.seongsu', version: 1, label: '성수',
  },
  ramen: {
    tokenId: 'place-type:food.noodle.ramen@1', kind: 'place-type',
    key: 'food.noodle.ramen', version: 1, label: '라멘',
  },
  cafe: {
    tokenId: 'place-type:drink.coffee.cafe@1', kind: 'place-type',
    key: 'drink.coffee.cafe', version: 1, label: '카페',
  },
}

function interpret(query, excludedTokenIds) {
  return [
    ...(query.includes('성수') ? [tokens.seongsu] : []),
    ...(query.includes('라멘') ? [tokens.ramen] : []),
    ...(query.includes('카페') ? [tokens.cafe] : []),
  ].filter((token) => !excludedTokenIds.includes(token.tokenId))
}

function filterItems(query, activeTokens) {
  let selected = query === '없음' ? [] : items
  if (activeTokens.includes(tokens.seongsu)) {
    selected = selected.filter((item) => item.area?.reference?.key === tokens.seongsu.key)
  }
  const activePlaceType = activeTokens.find((token) => token.kind === 'place-type')
  if (activePlaceType !== undefined) {
    selected = selected.filter((item) =>
      item.taxonomyReferences.some((reference) => reference.key === activePlaceType.key))
  }
  return selected
}

export function createCatalogSearchHandler() {
  const observations = []

  return async function handleCatalogSearch(request, response) {
    if (request.method === 'GET' && request.url === '/__test/catalog-search-observations') {
      sendPublicationJson(response, 200, observations)
      return true
    }
    if (request.method !== 'POST' || ![
      '/v1/search/catalog',
      '/v1/search/catalog/map',
    ].includes(request.url)) return false

    let body
    try { body = await readPublicationRequestJson(request) } catch {
      sendPublicationJson(
        response,
        400,
        { code: request.url.endsWith('/map')
          ? 'PLACE_CATALOG_MAP_REQUEST_INVALID'
          : 'PLACE_CATALOG_SEARCH_REQUEST_INVALID' },
        'application/problem+json',
      )
      return true
    }
    const query = String(body.query ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
    const excludedTokenIds = Array.isArray(body.excludedTokenIds) ? body.excludedTokenIds : []
    const activeTokens = interpret(query, excludedTokenIds)
    let selected = filterItems(query, activeTokens)

    if (request.url === '/v1/search/catalog') {
      observations.push({ query, excludedTokenIds, bounds: body.bounds ?? null })
      if (query === '오류') {
        sendPublicationJson(response, 503, {
          type: 'urn:place:error:catalog-search-unavailable',
          title: '카탈로그 검색을 잠시 사용할 수 없습니다.',
          status: 503,
          code: 'PLACE_CATALOG_SEARCH_UNAVAILABLE',
          retryable: true,
          correlationRef: 'e2e-catalog-search-error',
        }, 'application/problem+json')
        return true
      }
      if (body.bounds !== undefined) {
        selected = selected.filter((item) =>
          item.location.longitude >= body.bounds.west && item.location.longitude <= body.bounds.east &&
          item.location.latitude >= body.bounds.south && item.location.latitude <= body.bounds.north)
      }
      sendPublicationJson(response, 200, {
        schemaVersion: 'catalog-place-search.v1',
        interpretation: { normalizedQuery: query, tokens: activeTokens },
        items: selected,
        mapBounds: selected.length === 0 ? null : {
          west: Math.min(...selected.map((item) => item.location.longitude)) - 0.01,
          south: Math.min(...selected.map((item) => item.location.latitude)) - 0.01,
          east: Math.max(...selected.map((item) => item.location.longitude)) + 0.01,
          north: Math.max(...selected.map((item) => item.location.latitude)) + 0.01,
        },
      })
      return true
    }

    const viewport = body.viewport
    const longitudeMatches = (longitude) => viewport.west < viewport.east
      ? longitude >= viewport.west && longitude <= viewport.east
      : longitude >= viewport.west || longitude <= viewport.east
    selected = selected.filter((item) =>
      longitudeMatches(item.location.longitude) &&
      item.location.latitude >= viewport.south && item.location.latitude <= viewport.north)
    const clustered = Number(body.zoom) < 12 && selected.length > 0
    const features = clustered ? [{
      kind: 'cluster',
      featureId: `fixture-cluster:${body.zoom}`,
      location: {
        latitude: selected.reduce((sum, item) => sum + item.location.latitude, 0) / selected.length,
        longitude: selected.reduce((sum, item) => sum + item.location.longitude, 0) / selected.length,
      },
      bounds: {
        west: Math.min(...selected.map((item) => item.location.longitude)) - 0.01,
        south: Math.min(...selected.map((item) => item.location.latitude)) - 0.01,
        east: Math.max(...selected.map((item) => item.location.longitude)) + 0.01,
        north: Math.max(...selected.map((item) => item.location.latitude)) + 0.01,
      },
      placeCount: selected.length,
    }] : selected.map((item) => ({
      kind: 'place',
      featureId: `place:${item.placeId}`,
      placeId: item.placeId,
      name: item.name,
      location: item.location,
      areaLabel: item.area?.label ?? null,
      primaryTaxonomy: item.primaryTaxonomy === null ? null : {
        key: item.primaryTaxonomy.key,
        label: item.primaryTaxonomy.label,
      },
      placeCount: 1,
    }))
    sendPublicationJson(response, 200, {
      schemaVersion: 'catalog-place-map.v1',
      interpretation: { normalizedQuery: query, tokens: activeTokens },
      viewport,
      zoom: body.zoom,
      mode: clustered ? 'clusters' : 'places',
      features,
      coverage: {
        matchingPlaceCount: selected.length,
        representedPlaceCount: selected.length,
        complete: true,
      },
    })
    return true
  }
}

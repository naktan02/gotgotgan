import { sendPublicationJson } from './publication-http.mjs'

const collectionPublicationId = '01992d20-0000-7000-8000-000000000001'
const writingPublicationId = '01992d20-0000-7000-8000-000000000002'
const placeId = '01992d20-0000-7000-8000-000000000003'
const pendingPlaceId = '01992d20-0000-7000-8000-000000000004'
const secondPagePlaceId = '01992d20-0000-7000-8000-000000000055'
const publicProfileCollectionId = '01992d20-0000-7000-8000-000000000005'
const secondPublicProfileCollectionId = '01992d20-0000-7000-8000-000000000006'

const collectionPlaces = [{
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

export function createPublicContentHandler() {
  return async function handlePublicContent(request, response, requestUrl) {
    if (request.method === 'GET' && requestUrl.pathname === '/v1/public/profiles/ramen-log') {
      if (request.headers.authorization !== undefined) {
        sendPublicationJson(response, 400, { code: 'PLACE_PUBLIC_PROFILE_AUTHORITY_FORBIDDEN' }, 'application/problem+json')
        return true
      }
      const secondPage = requestUrl.searchParams.get('cursor') === 'profile-page-2'
      sendPublicationJson(response, 200, {
        schemaVersion: 'public-profile.v1',
        handle: 'ramen-log',
        displayName: '라멘 기록',
        collections: secondPage ? [{
          publicationId: secondPublicProfileCollectionId,
          name: '동네 카페 공개 목록',
          description: null,
          placeCount: 4,
          updatedAt: '2026-08-29T09:00:00.000Z',
        }] : [{
          publicationId: publicProfileCollectionId,
          name: '서울 라멘 공개 목록',
          description: '누구나 볼 수 있도록 공개한 목록',
          placeCount: 12,
          updatedAt: '2026-08-29T10:00:00.000Z',
        }],
        ...(secondPage ? {} : { nextCursor: 'profile-page-2' }),
      })
      return true
    }

    const requestedPlaceId = requestUrl.pathname.replace('/v1/places/', '')
    if (
      request.method === 'GET' &&
      [placeId, secondPagePlaceId].includes(requestedPlaceId) &&
      requestUrl.pathname.startsWith('/v1/places/')
    ) {
      if (request.headers.authorization !== undefined) {
        sendPublicationJson(response, 400, { code: 'PLACE_PUBLIC_DETAIL_AUTHORITY_FORBIDDEN' }, 'application/problem+json')
        return true
      }
      const selected = collectionPlaces.find((item) => item.placeId === requestedPlaceId)?.place
      sendPublicationJson(response, 200, {
        schemaVersion: 'place-detail.v1',
        status: 'available',
        requestedPlaceId,
        placeId: requestedPlaceId,
        redirectedFrom: [],
        ...selected,
      })
      return true
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
      sendPublicationJson(response, 200, {
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
      return true
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname === `/v1/public/collections/${collectionPublicationId}`
    ) {
      const secondPage = requestUrl.searchParams.get('cursor') === 'public-page-2'
      sendPublicationJson(response, 200, {
        schemaVersion: 'place-published-collection.v3',
        publicationId: collectionPublicationId,
        visibility: 'unlisted',
        name: '성수에서 다시 갈 곳',
        description: '링크를 받은 사람에게만 보이는 컬렉션',
        placeCount: collectionPlaces.length,
        places: secondPage ? collectionPlaces.slice(50) : collectionPlaces.slice(0, 50),
        ...(secondPage ? {} : { nextCursor: 'public-page-2' }),
        updatedAt: '2026-08-26T10:00:00.000Z',
      })
      return true
    }

    const projection = request.method === 'GET' ? projections.get(request.url ?? '') : undefined
    if (projection === undefined) return false
    sendPublicationJson(response, 200, projection)
    return true
  }
}

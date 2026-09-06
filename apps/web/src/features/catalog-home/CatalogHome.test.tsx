import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlaceMapRendererProperties } from '@/platform/maps/public'

import { CatalogHomeView, type CatalogHomePlaceDetailRenderer } from './CatalogHome'
import type { CatalogHomeWorkflow } from './catalog-home-workflow'

function FakeMap({
  description,
  initialCameraMode = 'supplied-bounds',
  markers,
}: PlaceMapRendererProperties) {
  return <div data-initial-camera-mode={initialCameraMode} data-map>{markers.length} markers · {description}</div>
}

const FakePlaceDetail: CatalogHomePlaceDetailRenderer = ({ place }) => <div>{place.name} · 주입된 공통 장소 상세</div>

const noOperation = () => undefined
const place = {
  placeId: '550e8400-e29b-41d4-a716-446655440000',
  name: '좌표 없는 전시 공간',
  areaLabel: '서울',
  location: null,
  taxonomyLabel: '문화시설',
  evidenceStatus: 'verified',
} as const

const workflow: CatalogHomeWorkflow = {
  searchIntent: 'conditions', destination: undefined, chooseDestination: noOperation, chooseCandidate: noOperation,
  draftQuery: '서울 전시',
  submittedQuery: '서울 전시',
  selectedQuickType: '문화시설',
  interpretation: [],
  items: [place],
  selected: place,
  searchState: 'ready',
  searchError: undefined,
  nextCursor: undefined,
  paginationState: 'idle',
  collections: [{ collectionId: 'collection-1', name: '전시 후보', placeCount: 2 }],
  collectionState: 'ready',
  collectionPickerOpen: true,
  viewport: { zoom: 11, bounds: { west: 126, south: 37, east: 128, north: 38 } },
  mapMarkers: [],
  mapClusters: [],
  mapState: 'unavailable',
  mapDescription: '현재 결과에는 표시할 좌표가 없습니다.',
  changeDraftQuery: noOperation,
  submitSearch: noOperation,
  toggleQuickType: noOperation,
  excludeToken: noOperation,
  selectPlace: noOperation,
  setCollectionPickerOpen: noOperation,
  onFilingApplied: async () => undefined,
  onFilingAccessFailure: noOperation,
  setViewport: noOperation,
  selectMapCluster: noOperation,
  loadMore: noOperation,
}

describe('Catalog Home view', () => {
  it.each([
    ['country', '대한민국', '국가'],
    ['city', '서울', '도시'],
    ['administrative-area', '경기도', '광역 지역'],
    ['locality', '양주시', '지역'],
    ['neighborhood', '성수동', '동네'],
  ] as const)('labels a %s destination independently from canonical place results', (kind, name, label) => {
    const markup = renderToStaticMarkup(<CatalogHomeView MapRenderer={FakeMap} PlaceDetailRenderer={FakePlaceDetail}
      workflow={{ ...workflow, items: [], selected: undefined, searchState: 'ready', destination: {
        key: 'region.fixture', name, kind, countryCode: 'KR', exact: true,
        location: { latitude: 36, longitude: 128 }, bounds: null,
      } }} />)
    expect(markup).toContain('지역 검색')
    expect(markup).toContain('1개 지역')
    expect(markup).toContain(`${label} · 지도에서 보기`)
    expect(markup).not.toContain('0곳')
  })

  it('does not invent an evidence label for a map-only place summary', () => {
    const markup = renderToStaticMarkup(
      <CatalogHomeView
        MapRenderer={FakeMap}
        PlaceDetailRenderer={FakePlaceDetail}
        workflow={{ ...workflow, items: [], selected: { ...place, evidenceStatus: 'unknown' } }}
      />,
    )

    expect(markup).toContain('좌표 없는 전시 공간')
    expect(markup).toContain('주입된 공통 장소 상세')
    expect(markup).not.toMatch(/검증됨|검토 전|정보 충돌|갱신 필요/)
  })

  it('keeps the same detail renderer available when coordinates are absent', () => {
    const markup = renderToStaticMarkup(
      <CatalogHomeView
        MapRenderer={FakeMap}
        PlaceDetailRenderer={FakePlaceDetail}
        workflow={workflow}
      />,
    )

    expect(markup).toContain('좌표 없는 전시 공간')
    expect(markup).toContain('주입된 공통 장소 상세')
    expect(markup).toContain('현재 결과에는 표시할 좌표가 없습니다')
    expect(markup).toContain('data-map')
    expect(markup).toContain('data-initial-camera-mode="supplied-bounds"')
    expect(markup).not.toContain('저장됨')
    expect(markup).not.toContain('가고 싶음')
  })

  it('opts into granted current location only for the empty idle Home camera', () => {
    const idleWorkflow: CatalogHomeWorkflow = {
      ...workflow,
      draftQuery: '',
      submittedQuery: '',
      selectedQuickType: null,
      items: [],
      selected: undefined,
      searchState: 'idle',
    }

    const markup = renderToStaticMarkup(
      <CatalogHomeView
        MapRenderer={FakeMap}
        PlaceDetailRenderer={FakePlaceDetail}
        workflow={idleWorkflow}
      />,
    )

    expect(markup).toContain('data-initial-camera-mode="granted-current-location"')
  })
})

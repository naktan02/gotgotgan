import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlaceMapRendererProperties } from '@/platform/maps/public'

import { CatalogHomeView } from './CatalogHome'
import type { CatalogHomeWorkflow } from './catalog-home-workflow'

function FakeMap({
  description,
  initialCameraMode = 'supplied-bounds',
  markers,
}: PlaceMapRendererProperties) {
  return <div data-initial-camera-mode={initialCameraMode} data-map>{markers.length} markers · {description}</div>
}

function FakePlaceFiling() {
  return <div>주입된 컬렉션 정리</div>
}

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
  recentlyFiled: [],
  viewport: { zoom: 11, bounds: { west: 126, south: 37, east: 128, north: 38 } },
  mapMarkers: [],
  mapClusters: [],
  mapState: 'unavailable',
  mapDescription: '현재 결과에는 표시할 좌표가 없습니다.',
  mobileSurface: 'list',
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
  searchViewport: noOperation,
  loadMore: noOperation,
  showList: noOperation,
  showMap: noOperation,
}

describe('Catalog Home view', () => {
  it('keeps the result and Collection chooser available when coordinates are absent', () => {
    const markup = renderToStaticMarkup(
      <CatalogHomeView
        MapRenderer={FakeMap}
        PlaceFilingRenderer={FakePlaceFiling}
        workflow={workflow}
      />,
    )

    expect(markup).toContain('좌표 없는 전시 공간')
    expect(markup).toContain('컬렉션 선택')
    expect(markup).toContain('주입된 컬렉션 정리')
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
        PlaceFilingRenderer={FakePlaceFiling}
        workflow={idleWorkflow}
      />,
    )

    expect(markup).toContain('data-initial-camera-mode="granted-current-location"')
  })
})

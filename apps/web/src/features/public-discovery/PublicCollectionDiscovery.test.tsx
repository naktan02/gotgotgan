import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlaceMapRendererProperties } from '@/platform/maps/public'

import { PublicCollectionDiscoveryView } from './PublicCollectionDiscovery'
import type { PublicCollectionDiscoveryWorkflow } from './public-collection-discovery-workflow'

const publicationId = '01992d20-0000-7000-8000-000000000001'
const placeId = '01992d20-0000-7000-8000-000000000002'
const place = {
  placeId,
  position: 0,
  place: {
    placeId,
    name: '도쿄 국립과학박물관',
    areaLabel: '도쿄 · 우에노',
    taxonomyLabel: '박물관',
    location: { latitude: 35.7166, longitude: 139.7761 },
  },
} as const
const collection = {
  publicationId,
  publicationVersion: 'publication-revision.v1.opaque',
  name: '도쿄 현지인이 추천하는 실내 가족 코스',
  description: '비 오는 날에도 아이와 함께 즐길 수 있는 장소예요.',
  placeCount: 1,
  updatedAt: '2026-09-03T00:00:00.000Z',
  owner: { handle: 'tokyo-curator', displayName: '도쿄새댁 유미' },
  topics: [{ key: 'family', label: '아이와 함께' }],
  previewPlaces: [place],
  places: [place],
} as const

function FakeMap({ markers, ariaLabel }: PlaceMapRendererProperties) {
  return <section aria-label={ariaLabel}>지도 장소 {markers.length}개</section>
}

function workflow(overrides: Partial<PublicCollectionDiscoveryWorkflow> = {}) {
  const noOperation = () => undefined
  return {
    draftQuery: '',
    filters: { query: '', areaKey: '', taxonomyKey: '', topicKey: '', sort: 'recent' },
    directory: {
      items: [collection],
      availableFilters: {
        areas: [{ key: 'jp.tokyo', label: '도쿄', count: 1 }],
        taxonomies: [{ key: 'culture.museum', label: '박물관', count: 1 }],
        topics: [{ key: 'family', label: '아이와 함께', count: 1 }],
      },
    },
    directoryState: 'ready',
    directoryLoadingMore: false,
    directoryPageError: false,
    selectedPublicationId: publicationId,
    selectedCollection: collection,
    detail: collection,
    detailState: 'ready',
    detailLoadingMore: false,
    detailPageError: false,
    selectedPlaceIds: new Set([placeId]),
    selectedMapPlaceId: placeId,
    copyState: { kind: 'idle' },
    shareStatus: 'idle',
    reportOpen: false,
    reportReason: 'spam',
    reportState: 'idle',
    mobileSurface: 'directory',
    setDraftQuery: noOperation,
    submitSearch: noOperation,
    changeFilter: noOperation,
    resetFilters: noOperation,
    select: noOperation,
    togglePlace: noOperation,
    copy: noOperation,
    share: noOperation,
    setMapSelectedPlaceId: noOperation,
    setReportOpen: noOperation,
    setReportReason: noOperation,
    report: noOperation,
    retryDirectory: noOperation,
    loadMoreDirectory: noOperation,
    retryDetail: noOperation,
    loadMoreDetail: noOperation,
    showMobileDirectory: noOperation,
    ...overrides,
  } as unknown as PublicCollectionDiscoveryWorkflow
}

describe('Public Collection discovery view', () => {
  it('renders discovery filters, author context, map preview, and explicit copy choices', () => {
    const markup = renderToStaticMarkup(
      <PublicCollectionDiscoveryView MapRenderer={FakeMap} workflow={workflow()} />,
    )

    expect(markup).toContain('공개 목록 주제 검색')
    expect(markup).toContain('전체 공개만')
    expect(markup).toContain('도쿄 현지인이 추천하는 실내 가족 코스')
    expect(markup).toContain('@tokyo-curator')
    expect(markup).toContain('지도 장소 1개')
    expect(markup).toContain('전체 복사')
    expect(markup).toContain('일부 복사 (1)')
    expect(markup).toContain('개인 메모, 방문 기록, 개인 사진과 평점은 공개되거나 복사되지 않습니다')
  })

  it('keeps authentication and version conflict states distinct', () => {
    const auth = renderToStaticMarkup(<PublicCollectionDiscoveryView
      MapRenderer={FakeMap}
      workflow={workflow({ copyState: { kind: 'authentication-required' } })}
    />)
    const conflict = renderToStaticMarkup(<PublicCollectionDiscoveryView
      MapRenderer={FakeMap}
      workflow={workflow({ copyState: { kind: 'conflict' } })}
    />)

    expect(auth).toContain('로그인')
    expect(conflict).toContain('원본이 변경되었습니다')
    expect(conflict).not.toContain('href="/api/auth/oidc/start"')
  })

  it('renders an honest empty directory without fabricated cards', () => {
    const markup = renderToStaticMarkup(<PublicCollectionDiscoveryView
      MapRenderer={FakeMap}
      workflow={workflow({
        selectedPublicationId: '',
        detail: undefined,
        directory: {
          items: [],
          availableFilters: { areas: [], taxonomies: [], topics: [] },
        },
      })}
    />)

    expect(markup).toContain('조건에 맞는 공개 목록이 없습니다')
    expect(markup).not.toContain('도쿄 현지인이 추천하는 실내 가족 코스')
  })
})

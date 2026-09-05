import type { LibraryMapResponse, PersonalLibraryMapResponseV2 } from '@place/contracts/library'

import type {
  PlaceMapCluster,
  PlaceMapRenderer,
  PlaceMapViewport,
} from '@/platform/maps/public'

export function PersonalLibraryMap({
  error,
  loading,
  projection,
  selectedPlaceId,
  viewport,
  onRetry,
  onSelect,
  onViewportChange,
  mapRenderer: MapRenderer,
}: Readonly<{
  error?: string
  loading: boolean
  projection?: LibraryMapResponse | PersonalLibraryMapResponseV2
  selectedPlaceId?: string
  viewport: PlaceMapViewport
  onRetry: () => void
  onSelect: (placeId: string) => void
  onViewportChange: (viewport: PlaceMapViewport) => void
  mapRenderer: PlaceMapRenderer
}>) {
  const markers = projection?.features.flatMap((feature) => feature.kind === 'place' ? [{
    id: feature.placeId,
    label: feature.label,
    location: feature.location,
  }] : []) ?? []
  const clusters: readonly PlaceMapCluster[] = projection?.features.flatMap((feature) => (
    feature.kind === 'cluster' ? [{
      id: feature.clusterId,
      count: feature.count,
      location: feature.location,
      bounds: feature.bounds,
    }] : []
  )) ?? []
  const represented = projection?.coverage.representedPlaceCount ?? 0
  const unprojected = projection?.coverage.unprojectedPlaceCount ?? 0
  const description = error ?? (loading
    ? '현재 지도 영역의 저장 장소를 불러오는 중입니다.'
    : projection === undefined
      ? '목록을 선택하면 해당 장소의 지도 정보를 불러옵니다.'
      : unprojected > 0
      ? `현재 영역 ${represented}개를 표시했습니다. 위치 투영 대기 ${unprojected}개가 있습니다.`
      : `현재 지도 영역의 저장 장소 ${represented}개를 모두 표현했습니다.`)

  return (
    <MapRenderer
      ariaLabel="내 장소 지도"
      bounds={viewport.bounds}
      clusters={clusters}
      description={description}
      markers={markers}
      moveLabel="지도 다시 불러오기"
      onClusterSelect={(cluster) => onViewportChange({
        bounds: cluster.bounds,
        zoom: Math.min(22, viewport.zoom + 2),
      })}
      onMove={error === undefined ? undefined : onRetry}
      onSelect={onSelect}
      onViewportChange={onViewportChange}
      selectedMarkerId={selectedPlaceId}
      title={`내 장소 ${represented}개`}
      zoom={viewport.zoom}
    />
  )
}

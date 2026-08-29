import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'
import type { PlaceMapBounds } from '@/platform/maps/place-map-interface'

import type { PersonalLibraryRow } from './personal-library-http'

const fallbackBounds: PlaceMapBounds = {
  north: 37.60,
  east: 127.10,
  south: 37.50,
  west: 126.90,
}

function fitBounds(rows: readonly PersonalLibraryRow[]): PlaceMapBounds {
  const locations = rows.flatMap((row) => row.place === null ? [] : [row.place.location])
  if (locations.length === 0) return fallbackBounds

  const latitudes = locations.map((location) => location.latitude)
  const longitudes = locations.map((location) => location.longitude)
  const north = Math.max(...latitudes)
  const east = Math.max(...longitudes)
  const south = Math.min(...latitudes)
  const west = Math.min(...longitudes)
  const latitudePadding = Math.max((north - south) * 0.22, 0.008)
  const longitudePadding = Math.max((east - west) * 0.22, 0.008)

  return {
    north: north + latitudePadding,
    east: east + longitudePadding,
    south: south - latitudePadding,
    west: west - longitudePadding,
  }
}

export function PersonalLibraryMap({
  rows,
  selectedPlaceId,
  onSelect,
}: Readonly<{
  rows: readonly PersonalLibraryRow[]
  selectedPlaceId?: string
  onSelect: (placeId: string) => void
}>) {
  const markers = rows.flatMap((row) => row.place === null ? [] : [{
    id: row.placeId,
    label: row.place.name,
    location: row.place.location,
  }])

  return (
    <DeterministicPlaceMap
      ariaLabel="내 장소 지도"
      bounds={fitBounds(rows)}
      description="현재 목록의 좌표입니다. 실제 지도는 연결 전입니다."
      markers={markers}
      onSelect={onSelect}
      selectedMarkerId={selectedPlaceId}
      title={`내 장소 ${markers.length}개`}
    />
  )
}

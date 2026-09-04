'use client'

import { PersonalPlaceDetail } from '@/features/personal-library/public'
import { MapLibrePlaceMap } from '@/platform/maps/public'
import {
  SearchWorkspace,
  type SearchCanonicalPlaceDetailRenderer,
} from '@/features/place-search/public'

const renderCanonicalPlaceDetail: SearchCanonicalPlaceDetailRenderer = ({ placeId, summary }) => (
  <PersonalPlaceDetail placeId={placeId} summary={summary} />
)

export function PlaceSearchWorkspace() {
  return (
    <SearchWorkspace
      mapRenderer={MapLibrePlaceMap}
      renderCanonicalPlaceDetail={renderCanonicalPlaceDetail}
    />
  )
}

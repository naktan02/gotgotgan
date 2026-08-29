'use client'

import { PersonalPlaceDetail } from '@/features/personal-library/public'
import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'
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
      mapRenderer={DeterministicPlaceMap}
      renderCanonicalPlaceDetail={renderCanonicalPlaceDetail}
    />
  )
}

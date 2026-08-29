'use client'

import { PersonalLibrary } from '@/features/personal-library/public'
import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

export function PlaceLibraryWorkspace() {
  return <PersonalLibrary mapRenderer={DeterministicPlaceMap} />
}

'use client'

import { useState } from 'react'

import {
  CatalogHomeProvider,
  CatalogHomeWorkspace,
  type CatalogHomeLibrary,
  type CatalogHomePlaceDetailRenderer,
} from '@/features/catalog-home/public'
import {
  CollectionLibrary,
  PersonalPlaceDetail,
  favoriteCollectionDirectory,
} from '@/features/personal-library/public'
import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { MapLibrePlaceMap } from '@/platform/maps/public'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'
import styles from './unified-home.module.css'

const homeLibrary: CatalogHomeLibrary = favoriteCollectionDirectory
const HomePlaceDetail: CatalogHomePlaceDetailRenderer = ({ place, navigationRef, onChanged }) => (
  <PersonalPlaceDetail placeId={place.placeId} navigationRef={navigationRef} onChanged={onChanged} summary={{
    name: place.name, areaLabel: place.areaLabel, location: place.location,
    primaryTaxonomy: place.taxonomyLabel ? { label: place.taxonomyLabel } : null,
  }} />
)

export function CatalogHomeApplication({
  familyNavigation,
  initialQuery,
}: Readonly<{ familyNavigation: FamilyNavigation; initialQuery?: string }>) {
  const [scope, setScope] = useState<'catalog' | 'favorites'>('catalog')
  const [query, setQuery] = useState(initialQuery ?? '')
  if (scope === 'favorites') {
    return (
      <PlaceWorkspaceShell familyNavigation={familyNavigation}>
        <CollectionLibrary initialQuery={query || undefined} initialScope="favorites" mapRenderer={MapLibrePlaceMap}
          scopeNavigation={(draft) => <nav aria-label="검색 대상" className={styles.scope}>
            <button onClick={() => { setQuery(draft); setScope('catalog') }} type="button">전체 장소</button>
            <span aria-current="page">즐겨찾기</span>
          </nav>} />
      </PlaceWorkspaceShell>
    )
  }
  return (
    <CatalogHomeProvider initialQuery={query} library={homeLibrary}
      openFavorites={(draft) => { setQuery(draft); setScope('favorites') }}>
      <PlaceWorkspaceShell familyNavigation={familyNavigation}>
        <CatalogHomeWorkspace
          MapRenderer={MapLibrePlaceMap}
          PlaceDetailRenderer={HomePlaceDetail}
        />
      </PlaceWorkspaceShell>
    </CatalogHomeProvider>
  )
}

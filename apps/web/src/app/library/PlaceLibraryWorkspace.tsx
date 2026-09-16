'use client'

import { CollectionLibrary } from '@/features/personal-library/public'
import { MapLibrePlaceMap } from '@/platform/maps/public'

export function PlaceLibraryWorkspace(initial: Readonly<{ initialQuery?: string; initialCollectionId?: string; initialScope?: 'directory' | 'favorites' }>) {
  return <CollectionLibrary {...initial} mapRenderer={MapLibrePlaceMap} scopeNavigation={(query) =>
    <nav aria-label="검색 대상" style={{ display: 'flex', gap: 16, fontSize: 13 }}>
      <a href={`/${query ? `?q=${encodeURIComponent(query)}` : ''}`}>전체 장소</a>
      <span aria-current="page">즐겨찾기</span>
    </nav>
  } />
}

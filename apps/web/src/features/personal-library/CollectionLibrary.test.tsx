import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlaceMapRendererProperties } from '@/platform/maps/place-map-interface'

import { CollectionLibraryView } from './CollectionLibrary'
import type { CollectionLibraryWorkflow } from './collection-library-workflow'

function FakeMap(_properties: PlaceMapRendererProperties) {
  return <div data-map />
}

const noOperation = () => undefined

describe('Collection-first Personal Library view', () => {
  it('offers a first user category without legacy favorite states', () => {
    const workflow = {
      pageStatus: 'ready',
      workspace: {
        schemaVersion: 'personal-library-workspace.v2',
        filter: {
          favoriteScope: { kind: 'all' },
          ratingFilter: { kind: 'any' },
          tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
        },
        collections: [], places: [],
        availableFilters: {
          coverage: { favoritePlaceCount: 0, sampledPlaceCount: 0, projectedPlaceCount: 0, complete: true },
          areas: [], taxonomies: [],
        },
      },
      collections: [],
      selectedCollectionId: undefined,
      selectedCollection: undefined,
      selectedPlaceId: undefined,
      selectedPlace: undefined,
      mobileSurface: 'list',
      collectionMutation: 'idle',
      collectionMessage: undefined,
      newCollectionName: '',
      showMobileSurface: noOperation,
      setNewCollectionName: noOperation,
      createCollection: noOperation,
    } as unknown as CollectionLibraryWorkflow

    const markup = renderToStaticMarkup(
      <CollectionLibraryView mapRenderer={FakeMap} workflow={workflow} />,
    )

    expect(markup).toContain('첫 카테고리를 만들어 보세요.')
    expect(markup).toContain('카테고리에 포함될 때 즐겨찾기가 됩니다.')
    expect(markup).not.toContain('저장됨')
    expect(markup).not.toContain('가고 싶음')
  })
})

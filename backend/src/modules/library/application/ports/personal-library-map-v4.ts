import type { CollectionColorToken } from '../../domain/collection-color.js'
import type {
  MapBounds, MapClassification, MapCoordinate,
} from '../../../../platform/map-projection/pixel-projection.js'

export type PersonalLibraryMapSelectionV4 =
  | Readonly<{ kind: 'all' }>
  | Readonly<{ kind: 'collections'; collectionIds: readonly string[] }>

export type PersonalLibraryMapCollectionV4 = Readonly<{
  collectionId: string
  name: string
  colorToken: CollectionColorToken
}>

export type PersonalLibraryMapPlaceFeatureV4 = Readonly<{
  kind: 'place'
  placeId: string
  label: string
  location: MapCoordinate
  classification: MapClassification
  memberships: readonly PersonalLibraryMapCollectionV4[]
}>

export type PersonalLibraryMapClusterFeatureV4 = Readonly<{
  kind: 'cluster'
  clusterId: string
  count: number
  location: MapCoordinate
  bounds: MapBounds
  coincidentPreview: Readonly<{
    places: readonly PersonalLibraryMapPlaceFeatureV4[]
    remainingCount: number
  }> | null
  collectionDistribution: readonly Readonly<{
    collectionId: string
    colorToken: CollectionColorToken
    placeCount: number
  }>[]
  remainingCollectionCount: number
}>

export type PersonalLibraryMapFeatureV4 =
  | PersonalLibraryMapPlaceFeatureV4
  | PersonalLibraryMapClusterFeatureV4

export type PersonalLibraryMapQueryV4 = Readonly<{
  memberId: string
  selection: PersonalLibraryMapSelectionV4
  placeQuery?: string | undefined
  ratingFilter: Readonly<{ kind: 'any' | 'rated' | 'unrated' }>
  tagIds: readonly string[]
  tagMatch: 'all' | 'any'
  areaKeys: readonly string[]
  taxonomyKeys: readonly string[]
  selectedPlaceId?: string | undefined
  bounds: MapBounds
  zoom: number
}>

export type PersonalLibraryMapViewV4 = Readonly<{
  schemaVersion: 'personal-library-map.v4'
  selection: PersonalLibraryMapSelectionV4
  filter: Readonly<{
    placeQuery?: string | undefined
    ratingFilter: PersonalLibraryMapQueryV4['ratingFilter']
    tagIds: readonly string[]
    tagMatch: PersonalLibraryMapQueryV4['tagMatch']
    areaKeys: readonly string[]
    taxonomyKeys: readonly string[]
  }>
  selectedCollections: readonly PersonalLibraryMapCollectionV4[]
  viewport: Readonly<{ bounds: MapBounds; zoom: number }>
  features: readonly PersonalLibraryMapFeatureV4[]
  coverage: Readonly<{
    representedPlaceCount: number
    unprojectedPlaceCount: number
    complete: boolean
  }>
}>

export interface PersonalLibraryMapV4 {
  openMapV4(query: PersonalLibraryMapQueryV4, signal?: AbortSignal): Promise<PersonalLibraryMapViewV4 | undefined>
}

import type { MapFeature } from '../../../../platform/map-projection/pixel-projection.js'
import type { PersonalLibraryMapQuery, PersonalLibraryMapView } from '../../domain/collection-first.js'

export type PersonalLibraryMapQueryV3 = PersonalLibraryMapQuery & Readonly<{ selectedPlaceId?: string | undefined }>
export type PersonalLibraryMapViewV3 = Omit<PersonalLibraryMapView, 'schemaVersion' | 'features'> & Readonly<{
  schemaVersion: 'personal-library-map.v3'; features: readonly MapFeature[]
}>
export interface PersonalLibraryMapV3 {
  openMapV3(query: PersonalLibraryMapQueryV3, signal?: AbortSignal): Promise<PersonalLibraryMapViewV3 | undefined>
}

import type { PersonalLibraryMapResponseV4 } from '@place/contracts/library'

import { mapAccentColor } from '../../platform/maps/map-accent-palette'
import type { PlaceMapCluster, PlaceMapMarker } from '../../platform/maps/public'

export function composeCatalogAndLibraryMap({
  catalogMarkers,
  catalogClusters,
  libraryProjection,
  showLibrary,
}: Readonly<{
  catalogMarkers: readonly PlaceMapMarker[]
  catalogClusters: readonly PlaceMapCluster[]
  libraryProjection: PersonalLibraryMapResponseV4 | undefined
  showLibrary: boolean
}>): Readonly<{ markers: readonly PlaceMapMarker[]; clusters: readonly PlaceMapCluster[] }> {
  if (!showLibrary || libraryProjection === undefined) {
    return { markers: catalogMarkers, clusters: catalogClusters }
  }

  const markersById = new Map(catalogMarkers.map((marker) => [marker.id, marker]))
  for (const feature of libraryProjection.features) {
    if (feature.kind !== 'place') continue
    const existing = markersById.get(feature.placeId)
    markersById.set(feature.placeId, {
      id: feature.placeId,
      label: existing?.label ?? feature.label,
      location: existing?.location ?? feature.location,
      classification: existing?.classification ?? feature.classification,
      accentColors: feature.memberships.map((membership) => mapAccentColor(membership.colorToken)),
      membershipLabels: feature.memberships.map((membership) => membership.name),
    })
  }

  const libraryClusters = libraryProjection.features.flatMap((feature): PlaceMapCluster[] => (
    feature.kind === 'place' ? [] : [{
      id: `library:${feature.clusterId}`,
      count: feature.count,
      location: feature.location,
      bounds: feature.bounds,
      coincidentPreview: feature.coincidentPreview,
      segments: feature.collectionDistribution.map((entry) => ({
        color: mapAccentColor(entry.colorToken),
        count: entry.placeCount,
      })),
    }]
  ))

  return { markers: [...markersById.values()], clusters: [...catalogClusters, ...libraryClusters] }
}

import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'

import type {
  PlaceMapCluster,
  PlaceMapMarker,
} from '../place-map-interface'

type MarkerConstructor = typeof import('maplibre-gl')['Marker']

type MarkerStyles = Readonly<{
  cluster: string
  marker: string
  selected: string
}>

export type AccessibleMarkerCallbacks = Readonly<{
  onClusterSelect?: (cluster: PlaceMapCluster) => void
  onSelect: (markerId: string) => void
}>

export function replaceAccessibleMarkers(input: Readonly<{
  map: MapLibreMap
  Marker: MarkerConstructor
  current: readonly MapLibreMarker[]
  focusFallback?: HTMLElement
  markers: readonly PlaceMapMarker[]
  clusters: readonly PlaceMapCluster[]
  selectedMarkerId?: string
  styles: MarkerStyles
  callbacks: AccessibleMarkerCallbacks
}>): readonly MapLibreMarker[] {
  const focusedElement = document.activeElement as HTMLElement | null
  const focusedFeatureId = focusedElement?.dataset.placeMapFeatureId
  const focusedFeatureKind = focusedElement?.dataset.placeMapFeatureKind
  input.current.forEach((marker) => marker.remove())
  const next: MapLibreMarker[] = []
  let focusRestored = false
  let firstMarkerButton: HTMLButtonElement | undefined
  input.clusters.forEach((cluster) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = input.styles.cluster
    button.dataset.placeMapFeatureId = cluster.id
    button.dataset.placeMapFeatureKind = 'cluster'
    button.textContent = String(cluster.count)
    button.setAttribute('aria-label', `${cluster.count}개 장소 묶음 확대`)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      input.callbacks.onClusterSelect?.(cluster)
    })
    next.push(new input.Marker({ element: button })
      .setLngLat([cluster.location.longitude, cluster.location.latitude])
      .addTo(input.map))
    if (focusedFeatureId === cluster.id) {
      button.focus()
      focusRestored = true
    }
  })
  input.markers.forEach((marker, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = marker.id === input.selectedMarkerId
      ? `${input.styles.marker} ${input.styles.selected}`
      : input.styles.marker
    button.dataset.placeMapFeatureId = marker.id
    button.dataset.placeMapFeatureKind = 'marker'
    firstMarkerButton ??= button
    button.textContent = String(index + 1)
    button.setAttribute('aria-label', `${marker.label} 지도에서 선택`)
    button.setAttribute('aria-pressed', String(marker.id === input.selectedMarkerId))
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      input.callbacks.onSelect(marker.id)
    })
    next.push(new input.Marker({ element: button })
      .setLngLat([marker.location.longitude, marker.location.latitude])
      .addTo(input.map))
    if (focusedFeatureId === marker.id) {
      button.focus()
      focusRestored = true
    }
  })
  if (!focusRestored && focusedFeatureKind === 'cluster') {
    (firstMarkerButton ?? input.focusFallback)?.focus()
  }
  return next
}

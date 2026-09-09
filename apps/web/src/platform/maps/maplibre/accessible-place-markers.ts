import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'

import type {
  PlaceMapCluster,
  PlaceMapMarker,
} from '../place-map-interface'
import { clusterBadgeOffset, markerPresentation, visibleMarkerLabels, type MapMarkerMode } from './marker-presentation'

type MarkerConstructor = typeof import('maplibre-gl')['Marker']

type MarkerStyles = Readonly<{
  cluster: string
  marker: string
  selected: string
  dot: string
  markerLabel: string
  markerSymbol: string
  collectionMarker: string
}>

function conicFill(segments: readonly Readonly<{ color: string; count: number }>[]): string | undefined {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  if (total <= 0) return undefined
  let consumed = 0
  const stops = segments.flatMap((segment) => {
    const start = consumed / total * 100
    consumed += segment.count
    const end = consumed / total * 100
    return [`${segment.color} ${start}%`, `${segment.color} ${end}%`]
  })
  return segments.length === 1 ? segments[0]?.color : `conic-gradient(${stops.join(', ')})`
}

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
  mode?: MapMarkerMode
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
  const container = input.map.getContainer()
  const markerScreens = [...input.markers].sort((a, b) => Number(b.id === input.selectedMarkerId) - Number(a.id === input.selectedMarkerId))
    .map((marker) => input.map.project([marker.location.longitude, marker.location.latitude]))
  input.clusters.forEach((cluster) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = input.styles.cluster
    button.dataset.placeMapFeatureId = cluster.id
    button.dataset.placeMapFeatureKind = 'cluster'
    button.textContent = String(cluster.count)
    const clusterFill = conicFill(cluster.segments ?? [])
    if (clusterFill !== undefined) button.style.setProperty('--cluster-fill', clusterFill)
    button.setAttribute('aria-label', cluster.coincidentPreview == null ? `${cluster.count}개 장소 묶음 확대` : `같은 위치의 장소 ${cluster.count}개 선택`)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      input.callbacks.onClusterSelect?.(cluster)
    })
    const offset = clusterBadgeOffset(input.map.project([cluster.location.longitude, cluster.location.latitude]),
      markerScreens, { width: container.clientWidth, height: container.clientHeight })
    next.push(new input.Marker({ element: button, offset })
      .setLngLat([cluster.location.longitude, cluster.location.latitude])
      .addTo(input.map))
    if (focusedFeatureId === cluster.id) {
      button.focus()
      focusRestored = true
    }
  })
  const labels = visibleMarkerLabels(input.markers, input.selectedMarkerId, input.map.getZoom(),
    (marker) => input.map.project([marker.location.longitude, marker.location.latitude]), input.map.getContainer().clientWidth)
  input.markers.forEach((marker) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = marker.id === input.selectedMarkerId
      ? `${input.styles.marker} ${input.styles.selected}`
      : input.styles.marker
    if ((marker.accentColors?.length ?? 0) > 0) button.className += ` ${input.styles.collectionMarker}`
    button.dataset.placeMapFeatureId = marker.id
    button.dataset.placeMapFeatureKind = 'marker'
    firstMarkerButton ??= button
    const presentation = markerPresentation(marker, input.mode ?? 'category', input.map.getZoom(), marker.id === input.selectedMarkerId)
    button.style.setProperty('--marker-color', presentation.color)
    const collectionFill = conicFill(marker.accentColors?.map((color) => ({ color, count: 1 })) ?? [])
    if (collectionFill !== undefined) button.style.setProperty('--collection-fill', collectionFill)
    button.style.zIndex = marker.id === input.selectedMarkerId ? '1000' : '1'
    const symbol = document.createElement('span')
    symbol.className = presentation.dot ? input.styles.dot : input.styles.markerSymbol
    symbol.setAttribute('aria-hidden', 'true')
    if (!presentation.dot && presentation.path !== undefined) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', presentation.path)
      svg.append(path)
      symbol.append(svg)
    }
    button.append(symbol)
    button.title = presentation.label === undefined ? marker.label : `${marker.label} · ${presentation.label}`
    if (labels.has(marker.id)) {
      const label = document.createElement('span')
      label.className = input.styles.markerLabel
      label.textContent = marker.label
      const screen = input.map.project([marker.location.longitude, marker.location.latitude])
      if (screen.x + 27 + Math.min(160, marker.label.length * 11 + 14) > input.map.getContainer().clientWidth - 8) {
        label.style.setProperty('left', 'auto')
        label.style.setProperty('right', '27px')
      }
      label.setAttribute('aria-hidden', 'true')
      button.append(label)
    }
    button.setAttribute('aria-label', `${marker.label}${marker.membershipLabels?.length
      ? ` · ${marker.membershipLabels.join(', ')}` : ''} 지도에서 선택`)
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

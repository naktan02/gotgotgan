import type { ComponentType } from 'react'
import type { MapPlaceClassificationV3, MapFeatureV3 } from '@place/contracts/maps'

export type PlaceMapBounds = Readonly<{
  north: number
  east: number
  south: number
  west: number
}>

export type PlaceMapViewport = Readonly<{
  bounds: PlaceMapBounds
  zoom: number
}>

export type PlaceMapInitialCameraMode = 'supplied-bounds' | 'granted-current-location'

export type PlaceMapMarker = Readonly<{
  id: string
  label: string
  location: Readonly<{ latitude: number; longitude: number }>
  classification?: MapPlaceClassificationV3
}>

export type PlaceMapCluster = Readonly<{
  id: string
  count: number
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: PlaceMapBounds
  coincidentPreview?: Extract<MapFeatureV3, {kind: 'cluster'}>['coincidentPreview']
}>

export type PlaceMapRendererProperties = Readonly<{
  ariaLabel?: string
  bounds: PlaceMapBounds
  clusters?: readonly PlaceMapCluster[]
  description?: string
  initialCameraMode?: PlaceMapInitialCameraMode
  markers: readonly PlaceMapMarker[]
  moveLabel?: string
  selectedMarkerId?: string
  title?: string
  zoom?: number
  onClusterSelect?: (cluster: PlaceMapCluster) => void
  onSelect: (markerId: string) => void
  onMove?: () => void
  onOpenPlaceList?: () => void
  onViewportChange?: (viewport: PlaceMapViewport) => void
}>

export type PlaceMapRenderer = ComponentType<PlaceMapRendererProperties>

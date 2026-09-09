import type { ComponentType } from 'react'
import type { MapPlaceClassificationV3 } from '@place/contracts/maps'

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
  accentColors?: readonly string[]
  membershipLabels?: readonly string[]
}>

export type PlaceMapCoincidentPreview = Readonly<{
  places: readonly Readonly<{
    placeId: string
    label: string
    location: Readonly<{ latitude: number; longitude: number }>
    classification?: MapPlaceClassificationV3
  }>[]
  remainingCount: number
}>

export type PlaceMapCluster = Readonly<{
  id: string
  count: number
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: PlaceMapBounds
  coincidentPreview?: PlaceMapCoincidentPreview | null
  segments?: readonly Readonly<{ color: string; count: number }>[]
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

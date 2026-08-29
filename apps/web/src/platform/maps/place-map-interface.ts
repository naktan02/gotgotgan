import type { ComponentType } from 'react'

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

export type PlaceMapMarker = Readonly<{
  id: string
  label: string
  location: Readonly<{ latitude: number; longitude: number }>
}>

export type PlaceMapCluster = Readonly<{
  id: string
  count: number
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: PlaceMapBounds
}>

export type PlaceMapRendererProperties = Readonly<{
  ariaLabel?: string
  bounds: PlaceMapBounds
  clusters?: readonly PlaceMapCluster[]
  description?: string
  markers: readonly PlaceMapMarker[]
  moveLabel?: string
  selectedMarkerId?: string
  title?: string
  zoom?: number
  onClusterSelect?: (cluster: PlaceMapCluster) => void
  onSelect: (markerId: string) => void
  onMove?: () => void
  onViewportChange?: (viewport: PlaceMapViewport) => void
}>

export type PlaceMapRenderer = ComponentType<PlaceMapRendererProperties>

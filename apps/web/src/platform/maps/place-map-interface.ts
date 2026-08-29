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

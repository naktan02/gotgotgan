export type PlaceMapBounds = Readonly<{
  north: number
  east: number
  south: number
  west: number
}>

export type PlaceMapMarker = Readonly<{
  id: string
  label: string
  location: Readonly<{ latitude: number; longitude: number }>
}>

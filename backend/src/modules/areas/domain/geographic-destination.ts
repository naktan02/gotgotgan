export type GeographicDestination = Readonly<{
  key: string
  kind: 'country' | 'city'
  name: string
  names: readonly string[]
  countryCode: string
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: Readonly<{ west: number; south: number; east: number; north: number }> | null
}>

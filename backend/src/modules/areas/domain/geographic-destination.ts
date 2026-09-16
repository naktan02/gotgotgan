export type GeographicDestination = Readonly<{
  key: string
  kind: 'country' | 'city' | 'administrative-area' | 'locality' | 'neighborhood'
  name: string
  names: readonly string[]
  countryCode: string
  contextLabel?: string
  location: Readonly<{ latitude: number; longitude: number }>
  bounds: Readonly<{ west: number; south: number; east: number; north: number }> | null
}>

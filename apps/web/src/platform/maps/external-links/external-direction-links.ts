type DirectionDestination = Readonly<{
  name: string
  location: Readonly<{ latitude: number; longitude: number }>
}>

export type ExternalDirectionLink = Readonly<{
  provider: 'naver' | 'google' | 'kakao'
  label: string
  href: string
}>

function validCoordinate(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

function validDestination(destination: DirectionDestination): void {
  if (destination.name.trim() === '' ||
    !validCoordinate(destination.location.latitude, -90, 90) ||
    !validCoordinate(destination.location.longitude, -180, 180)) {
    throw new Error('A direction destination requires a name and valid coordinates')
  }
}

function isSouthKoreanCoordinate(latitude: number, longitude: number): boolean {
  return latitude >= 32 && latitude <= 39.8 && longitude >= 124 && longitude <= 132
}

export function buildExternalDirectionLinks(
  destination: DirectionDestination,
): readonly ExternalDirectionLink[] {
  validDestination(destination)
  const { latitude, longitude } = destination.location
  const encodedName = encodeURIComponent(destination.name)
  const google = new URL('https://www.google.com/maps/dir/')
  google.search = new URLSearchParams({ api: '1', destination: `${latitude},${longitude}` }).toString()
  const naver = isSouthKoreanCoordinate(latitude, longitude)
    ? `nmap://route/public?dlat=${latitude}&dlng=${longitude}&dname=${encodedName}&appname=gotgotgan`
    : `https://map.naver.com/p/search/${encodedName}`
  return [
    { provider: 'naver', label: 'NAVER로 길찾기', href: naver },
    { provider: 'google', label: 'Google Maps로 길찾기', href: google.toString() },
    {
      provider: 'kakao',
      label: '카카오맵으로 길찾기',
      href: `https://map.kakao.com/link/to/${encodedName},${latitude},${longitude}`,
    },
  ]
}

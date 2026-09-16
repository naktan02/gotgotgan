import type { ProviderKey } from '@place/contracts/search'

type OpenablePlace = Readonly<{
  providerKey: ProviderKey
  providerPlaceId?: string
  name: string
  address: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
}>

export type ProviderOpenLink = Readonly<{
  providerKey: ProviderKey
  label: string
  href: string
}>

function searchQuery(place: OpenablePlace): string {
  return place.address === null ? place.name : `${place.name}, ${place.address}`
}

function naverLink(place: OpenablePlace): string {
  if (place.providerKey === 'naver' && place.providerPlaceId !== undefined) {
    return `https://map.naver.com/p/entry/place/${encodeURIComponent(place.providerPlaceId)}`
  }
  return `https://map.naver.com/p/search/${encodeURIComponent(searchQuery(place))}`
}

function googleLink(place: OpenablePlace): string {
  const parameters = new URLSearchParams({ api: '1', query: searchQuery(place) })
  if (place.providerKey === 'google' && place.providerPlaceId !== undefined) {
    parameters.set('query_place_id', place.providerPlaceId)
  }
  return `https://www.google.com/maps/search/?${parameters.toString()}`
}

function kakaoLink(place: OpenablePlace): string {
  if (place.providerKey === 'kakao' && place.providerPlaceId !== undefined) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(place.providerPlaceId)}`
  }
  if (place.location !== null) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.location.latitude},${place.location.longitude}`
  }
  return `https://map.kakao.com/link/search/${encodeURIComponent(searchQuery(place))}`
}

export function buildProviderOpenLinks(place: OpenablePlace): readonly ProviderOpenLink[] {
  return [
    { providerKey: 'naver', label: 'NAVER 지도', href: naverLink(place) },
    { providerKey: 'google', label: 'Google Maps', href: googleLink(place) },
    { providerKey: 'kakao', label: '카카오맵', href: kakaoLink(place) },
  ]
}

import { describe, expect, it } from 'vitest'

import { buildProviderOpenLinks } from './provider-open-links'

describe('provider open links', () => {
  it('uses the matching provider identity and safe cross-provider fallbacks', () => {
    const links = buildProviderOpenLinks({
      providerKey: 'naver',
      providerPlaceId: 'naver/place 1',
      name: '라멘 가게',
      address: '서울 중구',
      location: { latitude: 37.5, longitude: 127 },
    })

    expect(links).toEqual([
      {
        providerKey: 'naver', label: 'NAVER 지도',
        href: 'https://map.naver.com/p/entry/place/naver%2Fplace%201',
      },
      {
        providerKey: 'google', label: 'Google Maps',
        href: 'https://www.google.com/maps/search/?api=1&query=%EB%9D%BC%EB%A9%98+%EA%B0%80%EA%B2%8C%2C+%EC%84%9C%EC%9A%B8+%EC%A4%91%EA%B5%AC',
      },
      {
        providerKey: 'kakao', label: '카카오맵',
        href: 'https://map.kakao.com/link/map/%EB%9D%BC%EB%A9%98%20%EA%B0%80%EA%B2%8C,37.5,127',
      },
    ])
  })

  it('passes a Google Place ID only to Google Maps', () => {
    const links = buildProviderOpenLinks({
      providerKey: 'google', providerPlaceId: 'ChIJ-fixture',
      name: 'Place', address: null, location: null,
    })

    expect(links.find((link) => link.providerKey === 'google')?.href)
      .toContain('query_place_id=ChIJ-fixture')
    expect(links.filter((link) => link.providerKey !== 'google').map((link) => link.href).join())
      .not.toContain('ChIJ-fixture')
  })
})

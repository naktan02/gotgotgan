import { describe, expect, it } from 'vitest'

import { buildExternalDirectionLinks } from './external-direction-links'

describe('external direction links', () => {
  it('uses coordinates and a Korean NAVER app link for a Korean destination', () => {
    const links = buildExternalDirectionLinks({
      name: '멘야 하루',
      location: { latitude: 37.5447, longitude: 127.0557 },
    })

    expect(links.find((link) => link.provider === 'naver')?.href).toMatch(/^nmap:\/\/route\/public\?/)
    expect(links.find((link) => link.provider === 'google')?.href).toContain('destination=37.5447%2C127.0557')
    expect(links.find((link) => link.provider === 'kakao')?.href).toContain('37.5447,127.0557')
  })

  it('falls back to NAVER web search outside South Korea', () => {
    const links = buildExternalDirectionLinks({
      name: 'Tokyo Museum',
      location: { latitude: 35.6762, longitude: 139.6503 },
    })
    expect(links.find((link) => link.provider === 'naver')?.href).toBe(
      'https://map.naver.com/p/search/Tokyo%20Museum',
    )
  })

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(() => buildExternalDirectionLinks({
      name: 'Invalid', location: { latitude: Number.NaN, longitude: 127 },
    })).toThrow()
    expect(() => buildExternalDirectionLinks({
      name: 'Invalid', location: { latitude: 37, longitude: 181 },
    })).toThrow()
  })
})

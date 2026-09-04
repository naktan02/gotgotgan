import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ExternalDirectionActions } from './ExternalDirectionActions'

describe('ExternalDirectionActions', () => {
  it('renders fixed provider links with safe external navigation attributes', () => {
    const markup = renderToStaticMarkup(<ExternalDirectionActions destination={{
      name: '서울숲',
      location: { latitude: 37.5444, longitude: 127.0374 },
    }} />)

    expect(markup.match(/<a /g)).toHaveLength(3)
    expect(markup).toContain('NAVER로 길찾기')
    expect(markup).toContain('Google Maps로 길찾기')
    expect(markup).toContain('카카오맵으로 길찾기')
    expect(markup.match(/target="_blank"/g)).toHaveLength(3)
    expect(markup.match(/rel="external noopener noreferrer"/g)).toHaveLength(3)
  })

  it('does not offer directions before coordinates exist', () => {
    const markup = renderToStaticMarkup(<ExternalDirectionActions destination={{
      name: '동기화 중인 장소',
      location: null,
    }} />)

    expect(markup).toBe('')
  })
})

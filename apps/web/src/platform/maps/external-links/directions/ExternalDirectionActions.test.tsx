import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ExternalDirectionActions } from './ExternalDirectionActions'

describe('ExternalDirectionActions', () => {
  it('keeps fixed provider links inside a closed dialog behind one compact trigger', () => {
    const markup = renderToStaticMarkup(<ExternalDirectionActions destination={{
      name: '서울숲',
      location: { latitude: 37.5444, longitude: 127.0374 },
    }} />)

    expect(markup.match(/<a /g)).toHaveLength(3)
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toMatch(/<button[^>]*>.*길찾기<\/button>/)
    expect(markup).toContain('<dialog')
    expect(markup).not.toMatch(/<dialog[^>]* open/)
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

    expect(markup).toMatch(/<button[^>]*disabled=""/)
    expect(markup).toContain('좌표가 없어 길찾기를 사용할 수 없습니다')
    expect(markup).not.toContain('<a ')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CatalogInspection } from './CatalogInspection'

describe('read-only Admin catalog surface', () => {
  it('labels its limited projection and does not fabricate results or mutation controls', () => {
    const markup = renderToStaticMarkup(<CatalogInspection />)
    expect(markup).toContain('내부 카탈로그에 공개 투영된 장소만')
    expect(markup).toContain('장소·지역·분류 검색')
    expect(markup).toContain('0개 표시')
    expect(markup).toContain('왼쪽 목록에서 장소를 선택하세요.')
    expect(markup).not.toContain('병합 실행')
    expect(markup).not.toContain('장소 삭제')
  })
})

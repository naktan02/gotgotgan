import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MapLibrePlaceMap } from './MapLibrePlaceMap'

describe('MapLibre Place map adapter', () => {
  it('preserves the renderer retry action Interface', () => {
    const markup = renderToStaticMarkup(<MapLibrePlaceMap
      bounds={{ west: 126, south: 37, east: 128, north: 38 }}
      markers={[]}
      moveLabel="지도 다시 불러오기"
      onMove={() => undefined}
      onSelect={() => undefined}
    />)
    expect(markup).toContain('지도 다시 불러오기')
    expect(markup).toContain('<button')
  })
})

import { describe, expect, it } from 'vitest'
import { rewriteOpenFreeMapSourceRequest } from './source-location'

type Resource = NonNullable<Parameters<typeof rewriteOpenFreeMapSourceRequest>[1]>

describe('MapLibre fixed source request rewrite', () => {
  it('rewrites only the exact public TileJSON source, never tiles, styles or arbitrary URLs', () => {
    expect(rewriteOpenFreeMapSourceRequest('https://tiles.openfreemap.org/planet', 'Source' as Resource))
      .toEqual({ url: '/api/maps/openfreemap-source', credentials: 'same-origin' })
    for (const url of ['https://tiles.openfreemap.org/planet?url=http://127.0.0.1/',
      'https://tiles.openfreemap.org/planet/', 'https://tiles.openfreemap.org.evil.example/planet',
      '/fixture-style', 'https://tiles.openfreemap.org/styles/bright']) {
      expect(rewriteOpenFreeMapSourceRequest(url, 'Source' as Resource)).toEqual({ url })
    }
    for (const kind of ['Tile', 'Style', 'Glyphs', 'SpriteJSON'] as Resource[]) {
      expect(rewriteOpenFreeMapSourceRequest('https://tiles.openfreemap.org/planet', kind))
        .toEqual({ url: 'https://tiles.openfreemap.org/planet' })
    }
  })
})

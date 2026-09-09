import { describe, expect, it, vi } from 'vitest'

import { configureTransitAppearance } from './transit-appearance'

describe('OpenMapTiles rail and station presentation', () => {
  it('strengthens known rail layers and includes the current railway station class', () => {
    const layers = new Map([
      ['railway', { id: 'railway', type: 'line', source: 'openmaptiles', sourceLayer: 'transportation' }],
      ['railway-hatching', { id: 'railway-hatching', type: 'line', source: 'openmaptiles', sourceLayer: 'transportation' }],
      ['poi_transit', { id: 'poi_transit', type: 'symbol', source: 'openmaptiles', sourceLayer: 'poi' }],
    ])
    const map = {
      getLayer: vi.fn((id: string) => layers.get(id)),
      setPaintProperty: vi.fn(), setFilter: vi.fn(), setLayoutProperty: vi.fn(),
    }

    configureTransitAppearance(map as never)

    expect(map.setPaintProperty).toHaveBeenCalledWith('railway', 'line-color', '#71817b')
    expect(map.setPaintProperty).toHaveBeenCalledWith('railway-hatching', 'line-color', '#566861')
    expect(map.setFilter).toHaveBeenCalledWith('poi_transit', [
      'match', ['get', 'class'], ['airport', 'bus', 'rail', 'railway'], true, false,
    ])
    expect(map.setLayoutProperty).toHaveBeenCalledWith('poi_transit', 'icon-image', [
      'case', ['==', ['get', 'class'], 'railway'], 'rail', ['to-string', ['get', 'class']],
    ])
  })

  it('leaves unrelated custom-style layers unchanged', () => {
    const map = {
      getLayer: vi.fn(() => ({ id: 'railway', type: 'line', source: 'custom', sourceLayer: 'transportation' })),
      setPaintProperty: vi.fn(), setFilter: vi.fn(), setLayoutProperty: vi.fn(),
    }

    configureTransitAppearance(map as never)

    expect(map.setPaintProperty).not.toHaveBeenCalled()
    expect(map.setFilter).not.toHaveBeenCalled()
    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })
})

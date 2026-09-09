import { describe, expect, it, vi } from 'vitest'
import { configureGlobeAppearance } from './globe-appearance'

describe('globe presentation without a second map style', () => {
  it('uses the supported atmosphere without rewriting Bright colors', () => {
    const style = { sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: 'required' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
        { id: 'water', type: 'fill', paint: { 'fill-color': '#AECFE2' } },
        { id: 'road', type: 'line', paint: { 'line-color': '#fff' } }] }
    const map = { getStyle: () => style, setSky: vi.fn(), setLight: vi.fn(), setPaintProperty: vi.fn() }
    configureGlobeAppearance(map as never)
    expect(map.setSky).toHaveBeenCalledWith(expect.objectContaining({
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.42, 7, 0],
    }))
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })

  it('does not rewrite a different provider or expression-based custom color', () => {
    const map = { getStyle: () => ({ sources: {}, layers: [] }), setSky: vi.fn(), setLight: vi.fn(), setPaintProperty: vi.fn() }
    configureGlobeAppearance(map as never)
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })
})

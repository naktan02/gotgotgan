import { describe, expect, it, vi } from 'vitest'
import { configureGlobeAppearance } from './globe-appearance'

describe('globe presentation without a second map style', () => {
  it('uses the supported atmosphere and preserves detailed Bright colors, unrelated layers, and attribution', () => {
    const style = { sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: 'required' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
        { id: 'water', type: 'fill', paint: { 'fill-color': '#AECFE2' } },
        { id: 'road', type: 'line', paint: { 'line-color': '#fff' } }] }
    const before = structuredClone(style)
    const map = { getStyle: () => style, setSky: vi.fn(), setLight: vi.fn(), setPaintProperty: vi.fn() }
    configureGlobeAppearance(map as never)
    expect(map.setSky).toHaveBeenCalledWith(expect.objectContaining({
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.42, 7, 0],
    }))
    expect(map.setPaintProperty.mock.calls).toEqual([
      ['background', 'background-color', ['interpolate', ['linear'], ['zoom'], 0, '#b9c3bb', 5, '#b9c3bb', 8, '#f8f4f0']],
      ['water', 'fill-color', ['interpolate', ['linear'], ['zoom'], 0, '#718fa8', 5, '#718fa8', 8, '#AECFE2']],
    ])
    expect(style).toEqual(before)
  })

  it('does not rewrite a different provider or expression-based custom color', () => {
    const map = { getStyle: () => ({ sources: {}, layers: [] }), setSky: vi.fn(), setLight: vi.fn(), setPaintProperty: vi.fn() }
    configureGlobeAppearance(map as never)
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })
})

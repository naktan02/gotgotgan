import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import { replaceAccessibleMarkers } from './accessible-place-markers'

type NodeStub = { className: string; dataset: Record<string, string>; textContent: string; type: string; title: string;
  style: { setProperty: (...args: unknown[]) => unknown; zIndex: string }; append: (...args: unknown[]) => unknown;
  setAttribute: (...args: unknown[]) => unknown; addEventListener: (...args: unknown[]) => unknown; focus: () => void }

function harness(kind = 'marker') {
  let activeElement: NodeStub | null = null
  const buttons: NodeStub[] = []
  function element(tag = 'button'): NodeStub {
    const node = { className: '', dataset: {} as Record<string, string>, textContent: '', type: '', title: '',
      style: { setProperty: vi.fn(), zIndex: '' }, append: vi.fn(), setAttribute: vi.fn(), addEventListener: vi.fn(),
      focus: () => { activeElement = node } }
    if (tag === 'button') buttons.push(node)
    return node
  }
  const old = element()
  old.dataset.placeMapFeatureId = kind === 'marker' ? 'place-1' : 'cluster-1'
  old.dataset.placeMapFeatureKind = kind
  old.focus()
  vi.stubGlobal('document', { get activeElement() { return activeElement }, createElement: element, createElementNS: (_: string, tag: string) => element(tag) })
  class Marker { remove() {} setLngLat() { return this } addTo() { return this } }
  return { buttons, active: () => activeElement, input: {
    map: { getZoom: () => 14, project: () => ({ x: 200, y: 200 }), getContainer: () => ({ clientWidth: 1000, clientHeight: 900 }) } as unknown as MapLibreMap,
    Marker: Marker as unknown as typeof import('maplibre-gl')['Marker'],
    current: [new Marker() as unknown as MapLibreMarker], clusters: [],
    styles: { marker: 'marker', cluster: 'cluster', selected: 'selected', dot: 'dot', markerLabel: 'label', markerSymbol: 'symbol', collectionMarker: 'collection' },
    callbacks: { onSelect: () => undefined },
  } }
}
const place = (id: string) => ({ id, label: '장소', location: { latitude: 37, longitude: 127 } })
afterEach(() => vi.unstubAllGlobals())
describe('accessible MapLibre marker mirror', () => {
  it('restores focus when selected marker styling is replaced', () => {
    const fixture = harness()
    replaceAccessibleMarkers({ ...fixture.input, markers: [place('place-1')], selectedMarkerId: 'place-1' })
    expect(fixture.active()).toBe(fixture.buttons.at(-1))
    expect(fixture.buttons.at(-1)?.className).toBe('marker selected')
    expect(fixture.buttons.at(-1)?.style.zIndex).toBe('1000')
  })
  it('hands expanded cluster focus to its first replacement marker', () => {
    const fixture = harness('cluster')
    replaceAccessibleMarkers({ ...fixture.input, markers: [place('place-1'), place('place-2')] })
    expect(fixture.active()).toBe(fixture.buttons.at(-2))
  })
  it('uses the stable summary when an expanded cluster has no following marker', () => {
    const fixture = harness('cluster')
    const fallback = { focus: vi.fn() }
    replaceAccessibleMarkers({ ...fixture.input, markers: [], focusFallback: fallback as unknown as HTMLElement })
    expect(fallback.focus).toHaveBeenCalledOnce()
  })
})

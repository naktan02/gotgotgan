import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'

import { replaceAccessibleMarkers } from './accessible-place-markers'

type FakeButton = {
  className: string
  dataset: Record<string, string>
  focus: () => void
  setAttribute: (name: string, value: string) => void
  addEventListener: () => void
  textContent: string
  type: string
}

afterEach(() => vi.unstubAllGlobals())

describe('accessible MapLibre marker mirror', () => {
  it('restores focus when selected marker styling is replaced', () => {
    let activeElement: FakeButton | null = null
    const buttons: FakeButton[] = []
    const documentRef = {
      get activeElement() { return activeElement },
      createElement: () => {
        const button: FakeButton = {
          className: '', dataset: {}, textContent: '', type: '',
          addEventListener: () => undefined,
          setAttribute: () => undefined,
          focus: () => { activeElement = button },
        }
        buttons.push(button)
        return button
      },
    }
    const oldButton = documentRef.createElement()
    oldButton.dataset.placeMapFeatureId = 'place-1'
    oldButton.dataset.placeMapFeatureKind = 'marker'
    oldButton.focus()
    vi.stubGlobal('document', documentRef)

    class FakeMarker {
      remove() {}
      setLngLat() { return this }
      addTo() { return this }
    }
    replaceAccessibleMarkers({
      map: {} as MapLibreMap,
      Marker: FakeMarker as unknown as typeof import('maplibre-gl')['Marker'],
      current: [new FakeMarker() as unknown as MapLibreMarker],
      markers: [{ id: 'place-1', label: '장소', location: { latitude: 37, longitude: 127 } }],
      clusters: [],
      selectedMarkerId: 'place-1',
      styles: { marker: 'marker', cluster: 'cluster', selected: 'selected' },
      callbacks: { onSelect: () => undefined },
    })

    expect(activeElement).toBe(buttons.at(-1))
    expect(buttons.at(-1)?.className).toBe('marker selected')
  })

  it('hands focus from an expanded cluster to its first replacement marker', () => {
    let activeElement: FakeButton | null = null
    const buttons: FakeButton[] = []
    const documentRef = {
      get activeElement() { return activeElement },
      createElement: () => {
        const button: FakeButton = {
          className: '', dataset: {}, textContent: '', type: '',
          addEventListener: () => undefined,
          setAttribute: () => undefined,
          focus: () => { activeElement = button },
        }
        buttons.push(button)
        return button
      },
    }
    const oldCluster = documentRef.createElement()
    oldCluster.dataset.placeMapFeatureId = 'cluster-1'
    oldCluster.dataset.placeMapFeatureKind = 'cluster'
    oldCluster.focus()
    vi.stubGlobal('document', documentRef)

    class FakeMarker {
      remove() {}
      setLngLat() { return this }
      addTo() { return this }
    }
    replaceAccessibleMarkers({
      map: {} as MapLibreMap,
      Marker: FakeMarker as unknown as typeof import('maplibre-gl')['Marker'],
      current: [new FakeMarker() as unknown as MapLibreMarker],
      markers: [
        { id: 'place-1', label: '첫 장소', location: { latitude: 37, longitude: 127 } },
        { id: 'place-2', label: '둘째 장소', location: { latitude: 38, longitude: 128 } },
      ],
      clusters: [],
      styles: { marker: 'marker', cluster: 'cluster', selected: 'selected' },
      callbacks: { onSelect: () => undefined },
    })

    const firstReplacementMarker = buttons.at(-2)
    expect(activeElement).toBe(firstReplacementMarker)
    expect(firstReplacementMarker?.dataset.placeMapFeatureId).toBe('place-1')
  })

  it('hands focus from a removed cluster to the stable map summary when no marker follows', () => {
    let activeElement: FakeButton | null = null
    const documentRef = {
      get activeElement() { return activeElement },
      createElement: (): FakeButton => ({
        className: '', dataset: {}, textContent: '', type: '',
        addEventListener: () => undefined,
        setAttribute: () => undefined,
        focus: () => undefined,
      }),
    }
    const oldCluster: FakeButton = {
      className: '',
      dataset: { placeMapFeatureId: 'cluster-1', placeMapFeatureKind: 'cluster' },
      textContent: '',
      type: '',
      addEventListener: () => undefined,
      setAttribute: () => undefined,
      focus: () => { activeElement = oldCluster },
    }
    oldCluster.focus()
    vi.stubGlobal('document', documentRef)
    const focusFallback = { focus: vi.fn() }

    class FakeMarker {
      remove() {}
      setLngLat() { return this }
      addTo() { return this }
    }
    replaceAccessibleMarkers({
      map: {} as MapLibreMap,
      Marker: FakeMarker as unknown as typeof import('maplibre-gl')['Marker'],
      current: [new FakeMarker() as unknown as MapLibreMarker],
      focusFallback: focusFallback as unknown as HTMLElement,
      markers: [],
      clusters: [],
      styles: { marker: 'marker', cluster: 'cluster', selected: 'selected' },
      callbacks: { onSelect: () => undefined },
    })

    expect(focusFallback.focus).toHaveBeenCalledOnce()
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlaceMapRenderer } from '@/platform/maps/public'

import { PersonalLibraryMap } from './PersonalLibraryMap'

describe('Place map Renderer Interface', () => {
  it('lets a feature render through an injected Adapter', () => {
    const FakeMap: PlaceMapRenderer = ({ title, markers }) => (
      <div data-adapter="fake">{title}:{markers.map((marker) => marker.label).join(',')}</div>
    )
    const markup = renderToStaticMarkup(
      <PersonalLibraryMap
        loading={false}
        mapRenderer={FakeMap}
        onRetry={() => undefined}
        onSelect={() => undefined}
        onViewportChange={() => undefined}
        projection={{
          schemaVersion: 'library-map-projection.v1',
          scope: {
            kind: 'collection', collectionId: '01992d20-0000-7000-8000-000000000011',
          },
          viewport: {
            bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
          },
          features: [{
            kind: 'place', placeId: '01992d20-0000-7000-8000-000000000001',
            label: '주입된 장소', location: { latitude: 37.55, longitude: 127 },
          }],
          coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
        }}
        viewport={{
          bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
        }}
      />,
    )

    expect(markup).toContain('data-adapter="fake"')
    expect(markup).toContain('내 장소 1개:주입된 장소')
  })
})

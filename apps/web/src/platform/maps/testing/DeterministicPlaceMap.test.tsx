import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeterministicPlaceMap } from './DeterministicPlaceMap'

describe('deterministic Place map test adapter', () => {
  it('projects both sides of an antimeridian-crossing viewport continuously', () => {
    const markup = renderToStaticMarkup(<DeterministicPlaceMap
      bounds={{ west: 170, south: -10, east: -170, north: 10 }}
      markers={[
        { id: 'east', label: '동쪽', location: { latitude: 0, longitude: 179 } },
        { id: 'west', label: '서쪽', location: { latitude: 0, longitude: -179 } },
      ]}
      onSelect={() => undefined}
    />)
    expect(markup).toContain('left:45%')
    expect(markup).toContain('left:55%')
  })
})

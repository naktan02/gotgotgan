import { describe, expect, it, vi } from 'vitest'

import { configurePlaceMapProjection } from './map-projection'

describe('place map projection', () => {
  it('keeps one globe projection across world and detailed zoom levels', () => {
    const setProjection = vi.fn()

    configurePlaceMapProjection({ setProjection } as never)

    expect(setProjection).toHaveBeenCalledOnce()
    expect(setProjection).toHaveBeenCalledWith({ type: 'globe' })
  })
})

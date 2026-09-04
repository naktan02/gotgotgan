import { describe, expect, it } from 'vitest'

import { createPlaceFilingRequestGuard } from './place-filing-request-guard'

describe('Place filing request guard', () => {
  it('rejects an old Place response after selection changes', () => {
    const guard = createPlaceFilingRequestGuard()
    guard.activate('place-a')
    const first = guard.start('place-a')

    guard.activate('place-b')
    const second = guard.start('place-b')

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isActive('place-a')).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('accepts only the latest read for the same Place', () => {
    const guard = createPlaceFilingRequestGuard()
    guard.activate('place-a')
    const first = guard.start('place-a')
    const second = guard.start('place-a')

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })
})

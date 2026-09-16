import { describe, expect, it } from 'vitest'

import { createLibraryMapRequestGuard } from './library-map-request-guard'

describe('Library map request guard', () => {
  it('aborts and rejects the previous viewport request', () => {
    const guard = createLibraryMapRequestGuard()
    const first = guard.start()
    const second = guard.start()

    expect(first.signal.aborted).toBe(true)
    expect(guard.isCurrent(first)).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('invalidates a completed request during effect cleanup', () => {
    const guard = createLibraryMapRequestGuard()
    const request = guard.start()

    guard.cancel(request)

    expect(request.signal.aborted).toBe(true)
    expect(guard.isCurrent(request)).toBe(false)
  })
})

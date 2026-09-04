import { describe, expect, it } from 'vitest'

import { createCatalogMapRequestGuard } from './catalog-map-request-guard'

describe('Catalog map request guard', () => {
  it('prevents a deferred A map response from applying after B list search starts', async () => {
    const guard = createCatalogMapRequestGuard()
    const requestA = guard.start()
    let resolveA!: (value: string) => void
    const deferredA = new Promise<string>((resolve) => { resolveA = resolve })
    const applied: string[] = []
    const completion = deferredA.then((value) => {
      if (guard.isCurrent(requestA.generation)) applied.push(value)
    })

    guard.invalidate()
    resolveA('stale A markers')
    await completion

    expect(requestA.signal.aborted).toBe(true)
    expect(applied).toEqual([])
  })
})

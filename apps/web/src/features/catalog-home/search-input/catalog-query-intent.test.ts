import { describe, expect, it, vi } from 'vitest'
import type { CatalogExplorationResponse } from '@place/contracts/search'
import { createCatalogQueryIntentResolver } from './catalog-query-intent'

const exact = { key: 'country:KR', kind: 'country', countryCode: 'KR', name: '대한민국', exact: true, location: { latitude: 36, longitude: 128 }, bounds: null } as const
const response: CatalogExplorationResponse = {
  schemaVersion: 'catalog-exploration.v1', intent: 'name', destinations: [exact],
  places: [], conditions: [], unrecognizedText: '',
}
function deferred() {
  let resolve!: (value: CatalogExplorationResponse) => void
  const promise = new Promise<CatalogExplorationResponse>((done) => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const pending = deferred()
  const resolver = createCatalogQueryIntentResolver()
  const request = {
    query: '대한민국', intent: 'auto' as const, hasTaxonomy: false,
    explore: vi.fn((_signal: AbortSignal) => pending.promise),
    search: vi.fn(), chooseDestination: vi.fn(),
  }
  return { resolver, pending, request }
}

describe('Catalog query intent ownership', () => {
  it('cannot apply delayed initial URL interpretation after the user edits the query', async () => {
    const { resolver, pending, request } = setup()
    const initial = resolver.resolve(request)
    resolver.invalidate()
    pending.resolve(response)
    await initial
    expect(request.explore.mock.calls[0]![0].aborted).toBe(true)
    expect(request.chooseDestination).not.toHaveBeenCalled()
    expect(request.search).not.toHaveBeenCalled()
  })

  it('keeps explicit name intent when a pending fast Enter for identical text resolves later', async () => {
    const { resolver, pending, request } = setup()
    const automatic = resolver.resolve(request)
    await resolver.resolve({ ...request, intent: 'name' })
    pending.resolve(response)
    await automatic
    expect(request.search.mock.calls).toEqual([['name']])
    expect(request.chooseDestination).not.toHaveBeenCalled()
  })

  it('lets only the latest Enter interpretation choose a destination', async () => {
    const { resolver, pending, request } = setup()
    const initial = resolver.resolve(request)
    const next = { ...exact, key: 'city:tokyo', kind: 'city' as const, name: '도쿄' }
    await resolver.resolve({ ...request, query: '도쿄', explore: async () => ({ ...response, destinations: [next] }) })
    pending.resolve(response)
    await initial
    expect(request.chooseDestination.mock.calls).toEqual([[next]])
  })

  it('preserves an explicitly selected taxonomy instead of replacing it with an exact destination', async () => {
    const { resolver, request } = setup()
    await resolver.resolve({ ...request, hasTaxonomy: true })
    expect(request.explore).not.toHaveBeenCalled()
    expect(request.search).toHaveBeenCalledWith('auto')
    expect(request.chooseDestination).not.toHaveBeenCalled()
  })

  it('falls back only for the current failed interpretation', async () => {
    const { resolver, request } = setup()
    await resolver.resolve({ ...request, explore: async () => { throw new Error('offline') } })
    expect(request.search).toHaveBeenCalledWith('auto')
  })
})

import { describe, expect, it } from 'vitest'

import {
  resolvePlaceReference,
  type CanonicalResolutionStore,
} from '../index.js'

function storeWith(status: 'active' | 'retired' | 'not-found'): CanonicalResolutionStore {
  return {
    apply: async () => ({ status: 'invalid' }),
    resolve: async (placeId) => status === 'active'
      ? { status, placeId, redirectedFrom: [] }
      : status === 'retired'
        ? { status, placeId, redirectedFrom: [] }
        : { status },
    resolveProviderIdentity: async () => ({ status: 'not-found' }),
  }
}

describe('place-reference.v1', () => {
  it('returns a stable available reference after canonical resolution', async () => {
    await expect(resolvePlaceReference({
      placeId: '01992d03-0000-7000-8000-000000000001',
      disclosure: 'allowed',
      store: storeWith('active'),
    })).resolves.toEqual({
      schemaVersion: 'place-reference.v1',
      status: 'available',
      placeId: '01992d03-0000-7000-8000-000000000001',
    })
  })

  it('does not reveal existence when disclosure is denied', async () => {
    await expect(resolvePlaceReference({
      placeId: '01992d03-0000-7000-8000-000000000001',
      disclosure: 'denied',
      store: storeWith('active'),
    })).resolves.toEqual({ schemaVersion: 'place-reference.v1', status: 'redacted' })
  })

  it('returns unavailable for retired or absent Places', async () => {
    for (const status of ['retired', 'not-found'] as const) {
      await expect(resolvePlaceReference({
        placeId: '01992d03-0000-7000-8000-000000000001',
        disclosure: 'allowed',
        store: storeWith(status),
      })).resolves.toEqual({ schemaVersion: 'place-reference.v1', status: 'unavailable' })
    }
  })
})

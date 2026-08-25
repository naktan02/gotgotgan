import { describe, expect, it } from 'vitest'

import { parseFamilyNavigation, readFamilyNavigation } from './family-navigation'

describe('family navigation consumer', () => {
  it('accepts a projected active manifest without knowing family services in source', () => {
    expect(
      parseFamilyNavigation({
        contract: 'family-navigation.v1',
        deliveryState: 'active',
        items: [{ serviceId: 'example-service', label: 'Example', href: 'https://example.test/' }],
      }),
    ).toMatchObject({ deliveryState: 'active', items: [{ serviceId: 'example-service' }] })
  })

  it.each([
    'http://internal.example/',
    'https://user:secret@example.test/',
    'https://example.test/#credential',
  ])('rejects unsafe destination %s', (href) => {
    expect(() =>
      parseFamilyNavigation({
        contract: 'family-navigation.v1',
        deliveryState: 'active',
        items: [{ serviceId: 'unsafe', label: 'Unsafe', href }],
      }),
    ).toThrow()
  })

  it('fails closed when injected JSON is missing or invalid', () => {
    expect(readFamilyNavigation(undefined)).toEqual({
      contract: 'family-navigation.v1',
      deliveryState: 'not-integrated',
      items: [],
    })
    expect(readFamilyNavigation('{')).toEqual({
      contract: 'family-navigation.v1',
      deliveryState: 'integration-gated',
      items: [],
    })
  })

  it('rejects fields outside the versioned consumer contract', () => {
    expect(() =>
      parseFamilyNavigation({
        contract: 'family-navigation.v1',
        deliveryState: 'active',
        items: [],
        internalEndpoint: 'https://internal.example.test/',
      }),
    ).toThrow(/unsupported field/)
  })
})

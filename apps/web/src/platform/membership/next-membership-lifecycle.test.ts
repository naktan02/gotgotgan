import { describe, expect, it } from 'vitest'

import { createNextMembershipLifecycle } from './next-membership-lifecycle'

describe('Next membership lifecycle', () => {
  it('remains inactive unless membership activation is explicit', async () => {
    let created = false
    const lifecycle = createNextMembershipLifecycle({
      createBackend: () => {
        created = true
        throw new Error('must not create the backend client')
      },
    })

    await expect(lifecycle.install({})).resolves.toEqual({ state: 'disabled' })
    expect(lifecycle.current()).toBeUndefined()
    expect(created).toBe(false)
  })

  it('installs one backend client from deployment-owned configuration', async () => {
    const backend = {
      currentConsents: async () => new Response(null),
      onboard: async () => new Response(null),
    }
    let creations = 0
    const lifecycle = createNextMembershipLifecycle({
      createBackend: (config) => {
        creations += 1
        expect(config).toEqual({
          origin: 'http://place-backend.example',
          timeoutMilliseconds: 5_000,
        })
        return backend
      },
    })
    const environment = {
      PLACE_MEMBERSHIP_RUNTIME_ENABLED: 'true',
      PLACE_BACKEND_ORIGIN: 'http://place-backend.example',
      PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS: '5000',
    }

    await expect(
      Promise.all([lifecycle.install(environment), lifecycle.install(environment)]),
    ).resolves.toEqual([{ state: 'ready' }, { state: 'ready' }])
    expect(creations).toBe(1)
    expect(lifecycle.current()).toBe(backend)
  })

  it('rejects ambiguous activation and invalid bounded configuration', async () => {
    const dependencies = {
      createBackend: () => ({
        currentConsents: async () => new Response(null),
        onboard: async () => new Response(null),
      }),
    }

    await expect(
      createNextMembershipLifecycle(dependencies).install({
        PLACE_MEMBERSHIP_RUNTIME_ENABLED: 'tru',
      }),
    ).rejects.toThrow('Membership runtime activation is invalid')
    await expect(
      createNextMembershipLifecycle(dependencies).install({
        PLACE_MEMBERSHIP_RUNTIME_ENABLED: 'true',
        PLACE_BACKEND_ORIGIN: 'http://place-backend.example',
        PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS: '60001',
      }),
    ).rejects.toThrow('Membership runtime configuration is invalid')
  })
})

import { describe, expect, it } from 'vitest'

import { createNextImportLifecycle } from './next-import-lifecycle'

describe('Next import lifecycle', () => {
  it('is disabled unless import activation is explicit', async () => {
    let created = false
    const lifecycle = createNextImportLifecycle({
      createBackend: () => {
        created = true
        throw new Error('must not create backend')
      },
    })

    await expect(lifecycle.install({})).resolves.toEqual({ state: 'disabled' })
    expect(lifecycle.current()).toBeUndefined()
    expect(created).toBe(false)
  })

  it('installs one bounded backend client from deployment configuration', async () => {
    const backend = {
      ready: async () => new Response(), connections: async () => new Response(),
      start: async () => new Response(), detail: async () => new Response(),
      cancel: async () => new Response(), resume: async () => new Response(),
      review: async () => new Response(),
    }
    let creations = 0
    const lifecycle = createNextImportLifecycle({
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
      PLACE_IMPORT_RUNTIME_ENABLED: 'true',
      PLACE_BACKEND_ORIGIN: 'http://place-backend.example',
      PLACE_IMPORT_BACKEND_TIMEOUT_MILLISECONDS: '5000',
    }

    await expect(Promise.all([
      lifecycle.install(environment), lifecycle.install(environment),
    ])).resolves.toEqual([{ state: 'ready' }, { state: 'ready' }])
    expect(creations).toBe(1)
    expect(lifecycle.current()).toBe(backend)
  })

  it('rejects ambiguous activation and invalid bounded configuration', async () => {
    const dependencies = { createBackend: () => ({}) as never }
    await expect(createNextImportLifecycle(dependencies).install({
      PLACE_IMPORT_RUNTIME_ENABLED: 'yes',
    })).rejects.toThrow('Import runtime activation is invalid')
    await expect(createNextImportLifecycle(dependencies).install({
      PLACE_IMPORT_RUNTIME_ENABLED: 'true',
      PLACE_BACKEND_ORIGIN: 'http://place-backend.example',
      PLACE_IMPORT_BACKEND_TIMEOUT_MILLISECONDS: '0',
    })).rejects.toThrow('Import runtime configuration is invalid')
  })
})

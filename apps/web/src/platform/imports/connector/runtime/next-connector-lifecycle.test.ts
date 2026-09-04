import { describe, expect, it, vi } from 'vitest'

import { createNextConnectorLifecycle } from './next-connector-lifecycle'

const environment = {
  PLACE_CONNECTOR_RUNTIME_ENABLED: 'true',
  PLACE_BACKEND_ORIGIN: 'http://backend:4010',
  PLACE_CONNECTOR_PUBLIC_ORIGIN: 'https://place.example',
  PLACE_CONNECTOR_BACKEND_TIMEOUT_MILLISECONDS: '5000',
}

describe('next connector lifecycle', () => {
  it('installs the v2 grant client from one validated configuration', async () => {
    const transfers = { kind: 'transfers' }
    const createTransferBackend = vi.fn(() => transfers)
    const lifecycle = createNextConnectorLifecycle({
      createTransferBackend: createTransferBackend as never,
    })

    await expect(lifecycle.install(environment)).resolves.toEqual({ state: 'ready' })
    expect(createTransferBackend).toHaveBeenCalledWith({
      origin: 'http://backend:4010', publicOrigin: 'https://place.example',
      timeoutMilliseconds: 5_000,
    })
    expect(lifecycle.current()).toBe(transfers)
  })

  it('keeps the client unavailable when activation is disabled or installation fails', async () => {
    const disabledTransfer = vi.fn()
    const disabled = createNextConnectorLifecycle({
      createTransferBackend: disabledTransfer,
    })
    await expect(disabled.install({ PLACE_CONNECTOR_RUNTIME_ENABLED: 'false' }))
      .resolves.toEqual({ state: 'disabled' })
    expect(disabledTransfer).not.toHaveBeenCalled()

    const failed = createNextConnectorLifecycle({
      createTransferBackend: (() => { throw new Error('invalid transfer client') }) as never,
    })
    await expect(failed.install(environment)).rejects.toThrow('invalid transfer client')
    expect(failed.current()).toBeUndefined()
  })
})

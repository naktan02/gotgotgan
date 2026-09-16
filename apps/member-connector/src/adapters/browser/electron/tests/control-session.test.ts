import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopControlSession, desktopControlUrl, isTrustedControlSender } from '../control-session.js'
import type { DesktopAcquisitionProvider } from '../../../../application/ports/desktop-acquisition-provider.js'
import { previewSavedLibrary } from '../../../../application/preview-saved-library.js'
import type { SavedLibraryPreview } from '../../../../application/preview-saved-library.js'
import type { ProviderSessionState } from '../../../../application/ports/provider-session.js'

const summary = { listCount: 1, itemCount: 1, missingIdentityCount: 0, serverSaved: false as const }
type Probe = (signal: AbortSignal) => Promise<ProviderSessionState>
function setup(overrides: Partial<{
  probe: Probe
  collect: (signal: AbortSignal) => Promise<SavedLibraryPreview>
}> = {}) {
  let close!: () => void
  let url = 'https://provider.invalid/login'
  const window = { closed: new Promise<void>((resolve) => { close = resolve }),
    currentUrl: () => url, close: vi.fn(() => close()) }
  const provider = {
    probe: vi.fn<Probe>().mockResolvedValue('active'),
    collect: vi.fn(async () => summary), ...overrides,
  }
  const descriptor: DesktopAcquisitionProvider = {
    label: 'Synthetic provider', loginUrl: url, allowsLoginNavigation: () => true,
    canProbeLogin: (value: string) => value === 'https://provider.invalid/returned',
    acquisition: {
      source: { providerKey: 'naver', collect: async function* () {} },
      session: { providerKey: 'naver', probe: ({ signal }) => provider.probe(signal) },
      normalizer: { providerKey: 'naver', parserVersion: 'test.v1', normalize: () => ({ lists: [] }) },
    },
  }
  const openLogin = vi.fn(() => window)
  return { provider, window, openLogin, workflow: new DesktopControlSession(() => descriptor, openLogin,
    (_acquisition, signal) => provider.collect(signal)),
    returned: () => { url = 'https://provider.invalid/returned' },
    authenticating: () => { url = 'https://provider.invalid/login' } }
}
afterEach(() => vi.useRealTimers())

describe('Provider-neutral Desktop authentication and acquisition', () => {
  it('accepts only exact local main-frame IPC sender', () => {
    const sender = { expectedContentsId: 2, contentsId: 2, frameUrl: desktopControlUrl, mainFrame: true }
    expect(isTrustedControlSender(sender)).toBe(true)
    for (const change of [{ contentsId: 3 }, { frameUrl: 'https://provider.invalid/' },
      { mainFrame: false }, { frameUrl: `${desktopControlUrl}?spoof=1` }]) {
      expect(isTrustedControlSender({ ...sender, ...change })).toBe(false)
    }
  })

  it('collects directly after an active probe and rechecks on the next click', async () => {
    const test = setup()
    expect(await test.workflow.execute('collect')).toEqual({ state: 'collected', summary })
    expect(await test.workflow.execute('collect')).toEqual({ state: 'collected', summary })
    expect(test.provider.probe).toHaveBeenCalledTimes(2)
    expect(test.openLogin).not.toHaveBeenCalled()
    expect((await test.workflow.execute('login')).state).toBe('error')
  })

  it('waits for an eligible return page and verified authentication before auto-close and collection', async () => {
    vi.useFakeTimers()
    const probe = vi.fn<Probe>().mockResolvedValueOnce('reauth-required').mockResolvedValue('active')
    const test = setup({ probe })
    const result = test.workflow.execute('collect')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(probe).toHaveBeenCalledOnce()
    expect(test.provider.collect).not.toHaveBeenCalled()
    expect(test.window.close).not.toHaveBeenCalled()
    test.returned()
    await vi.advanceTimersByTimeAsync(3000)
    expect(await result).toEqual({ state: 'collected', summary })
    expect(test.window.close).toHaveBeenCalledOnce()
    expect(test.provider.collect).toHaveBeenCalledOnce()
  })

  it('does not accept a manually closed login as authentication', async () => {
    vi.useFakeTimers()
    const test = setup({ probe: vi.fn().mockResolvedValue('reauth-required') })
    const result = test.workflow.execute('collect')
    await vi.advanceTimersByTimeAsync(0)
    test.window.close()
    expect((await result).state).toBe('error')
    expect(test.provider.collect).not.toHaveBeenCalled()
  })

  it('rejects duplicate acquisition and aborts login on cancellation', async () => {
    vi.useFakeTimers()
    const test = setup({ probe: vi.fn().mockResolvedValue('reauth-required') })
    const result = test.workflow.execute('collect')
    await vi.advanceTimersByTimeAsync(0)
    expect((await test.workflow.execute('collect')).state).toBe('busy')
    expect((await test.workflow.execute('cancel')).state).toBe('cancelled')
    expect((await result).state).toBe('cancelled')
    expect(test.window.close).toHaveBeenCalledOnce()
    expect(test.provider.collect).not.toHaveBeenCalled()
  })

  it('bounds login to five minutes without probing the authentication page', async () => {
    vi.useFakeTimers()
    const test = setup({ probe: vi.fn().mockResolvedValue('reauth-required') })
    const result = test.workflow.execute('collect')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect((await result).state).toBe('error')
    expect(test.provider.probe).toHaveBeenCalledOnce()
    expect(test.window.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops repeated checks on unavailable or contract drift instead of reopening login', async () => {
    vi.useFakeTimers()
    for (const failure of ['unavailable', new Error('schema changed')] as const) {
      const probe = vi.fn<Probe>().mockResolvedValueOnce('reauth-required')
      if (failure instanceof Error) probe.mockRejectedValue(failure)
      else probe.mockResolvedValue(failure)
      const test = setup({ probe }); test.returned()
      const result = test.workflow.execute('collect')
      await vi.advanceTimersByTimeAsync(3000)
      expect((await result).state).toBe('error')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(probe).toHaveBeenCalledTimes(2)
      expect(test.provider.collect).not.toHaveBeenCalled()
      expect(test.window.close).toHaveBeenCalledOnce()
    }
  })

  it('closes in-flight acquisition on shutdown and rejects further commands', async () => {
    let signal!: AbortSignal
    const test = setup({ collect: (current) => new Promise((resolve) => {
      signal = current; current.addEventListener('abort', () => resolve(summary), { once: true })
    }) })
    const result = test.workflow.execute('collect'); await Promise.resolve()
    test.workflow.close()
    expect(signal.aborted).toBe(true)
    expect((await result).state).toBe('cancelled')
    expect((await test.workflow.execute('collect')).state).toBe('error')
  })

  it('stops on unavailable even if the login page changes during the probe', async () => {
    vi.useFakeTimers()
    let respond!: (state: ProviderSessionState) => void
    const probe = vi.fn<Probe>().mockResolvedValueOnce('reauth-required')
      .mockImplementation(() => new Promise((resolve) => { respond = resolve }))
    const test = setup({ probe }); test.returned()
    const result = test.workflow.execute('collect')
    await vi.advanceTimersByTimeAsync(3000)
    test.authenticating()
    respond('unavailable')
    expect((await result).state).toBe('error')
    test.returned()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(test.provider.collect).not.toHaveBeenCalled()
    expect(test.window.close).toHaveBeenCalledOnce()
  })

  it('preserves unavailable distinct from reauthentication in normalized preview', async () => {
    const source = { providerKey: 'naver' as const, collect: vi.fn(async function* () {}) }
    await expect(previewSavedLibrary({ source,
      session: { providerKey: 'naver', probe: async () => 'unavailable' },
      normalizer: { providerKey: 'naver', parserVersion: 'test.v1', normalize: () => ({ lists: [] }) },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider-unavailable' })
    expect(source.collect).not.toHaveBeenCalled()
  })
})

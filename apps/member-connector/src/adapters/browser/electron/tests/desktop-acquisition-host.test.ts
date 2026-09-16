import { afterEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => {
  const windows: Window[] = []
  const handlers = new Map<string, (...args: any[]) => any>()
  const sessions: any[] = []
  class Window {
    readonly events = new Map<string, (...args: any[]) => void>()
    readonly webContents = {
      id: windows.length + 1, mainFrame: { url: '' },
      setWindowOpenHandler: vi.fn(), on: vi.fn(),
      getURL: () => this.webContents.mainFrame.url,
    }
    destroyed = false
    constructor(readonly options: any) { windows.push(this) }
    once(name: string, listener: (...args: any[]) => void) { this.events.set(name, listener) }
    async loadURL(url: string) { this.webContents.mainFrame.url = url }
    close() { this.destroyed = true; this.events.get('closed')?.() }
    destroy() { this.destroyed = true; this.events.get('closed')?.() }
    isDestroyed() { return this.destroyed }
  }
  return { windows, handlers, sessions, Window }
})

vi.mock('electron', () => ({
  BrowserWindow: host.Window,
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => host.handlers.set(name, handler),
    removeHandler: (name: string) => host.handlers.delete(name),
  },
  session: { fromPartition: (partition: string) => {
    const session = {
      partition, setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
      on: vi.fn(), protocol: { handle: vi.fn(), unhandle: vi.fn() }, fetch: vi.fn(),
      closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}),
    }
    host.sessions.push(session)
    return session
  } },
}))

import { openDesktopAcquisitionHost } from '../desktop-acquisition-host.js'
import { desktopControlChannel } from '../control-session.js'
import type { DesktopAcquisitionProvider } from '../../../../application/ports/desktop-acquisition-provider.js'
import type { ProviderSession } from '../../../../application/ports/provider-session.js'

afterEach(() => vi.useRealTimers())

describe('Desktop Electron host composition', () => {
  it('isolates login from local privileges and collection, then closes resources', async () => {
    vi.useFakeTimers()
    const provider: DesktopAcquisitionProvider = {
      label: 'Synthetic', loginUrl: 'https://provider.invalid/',
      allowsLoginNavigation: () => true, canProbeLogin: () => true,
      acquisition: {
        session: { providerKey: 'naver', probe: vi.fn<ProviderSession['probe']>().mockResolvedValueOnce('reauth-required').mockResolvedValue('active') },
        source: { providerKey: 'naver', collect: async function* () {} },
        normalizer: { providerKey: 'naver', parserVersion: 'test.v1', normalize: () => ({ lists: [] }) },
      },
    }
    await openDesktopAcquisitionHost(() => provider, { visible: false })
    const control = host.windows[0]!
    const command = host.handlers.get(desktopControlChannel)!
    const sender = { sender: control.webContents, senderFrame: control.webContents.mainFrame }
    expect(host.sessions).toHaveLength(2)
    expect(host.sessions.every((session) => !session.partition.startsWith('persist:'))).toBe(true)
    expect(control.options.show).toBe(false)
    expect(control.options.webPreferences.preload).toMatch(/preload\.cjs$/u)
    const login = command(sender, 'collect')
    await vi.advanceTimersByTimeAsync(0)
    const remote = host.windows[1]!
    expect(remote.options.webPreferences).toMatchObject({
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
    })
    expect(remote.options.webPreferences).not.toHaveProperty('preload')
    expect(remote.options.webPreferences.session).not.toBe(control.options.webPreferences.session)
    expect(remote.webContents.on.mock.calls.map(([name]) => name)).toEqual([
      'will-attach-webview', 'will-frame-navigate', 'will-redirect',
    ])
    expect(host.sessions[0].fetch).not.toHaveBeenCalled()
    expect(() => command({ sender: remote.webContents, senderFrame: remote.webContents.mainFrame }, 'collect')).toThrow('rejected')
    expect(() => command(sender, 'collect', 'unexpected')).toThrow('rejected')
    // A hostile beforeunload can veto close(), but cannot veto the app-owned destroy().
    remote.close = vi.fn()
    await vi.advanceTimersByTimeAsync(3000)
    expect(await login).toMatchObject({ state: 'collected' })
    expect(remote.destroyed).toBe(true)
    expect(remote.close).not.toHaveBeenCalled()
    control.close()
    expect(host.handlers.has(desktopControlChannel)).toBe(false)
    expect(host.sessions[0].closeAllConnections).toHaveBeenCalledOnce()
    expect(host.sessions[0].clearStorageData).toHaveBeenCalledOnce()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

const app = vi.hoisted(() => ({
  enableSandbox: vi.fn(), setName: vi.fn(), requestSingleInstanceLock: vi.fn(() => false),
  quit: vi.fn(), exit: vi.fn(), on: vi.fn(), whenReady: vi.fn(),
}))
vi.mock('electron', () => ({
  app, protocol: { registerSchemesAsPrivileged: vi.fn() },
  BrowserWindow: vi.fn(), ipcMain: {}, session: {},
}))

const initialArguments = process.argv
afterEach(() => { process.argv = initialArguments; vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Desktop entrypoint instance ownership', () => {
  it('fails the local smoke when another instance owns the app instead of claiming success', async () => {
    process.argv = ['electron', 'main.js', '--check-desktop']
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await import('./main.js')
    expect(app.exit).toHaveBeenCalledWith(1)
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.whenReady).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith('Desktop smoke unavailable: another Connector instance is running.\n')
  })
})

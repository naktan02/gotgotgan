import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, session, type Session } from 'electron'

import { previewSavedLibrary } from '../../../application/preview-saved-library.js'
import {
  createNaverSavedPlaceCollector, NaverApiSavedPlaceSource, NaverProviderSession,
} from '../../providers/naver/api/saved-place-source.js'
import {
  allowsNaverLoginNavigation, allowsNaverSavedPlaceRequest, naverMemberPageUrl,
} from '../../providers/naver/api/request-policy.js'
import { NaverSavedPlaceSnapshotNormalizer } from '../../providers/naver/snapshot/saved-place-snapshot-normalizer.js'
import { ElectronAuthenticatedJsonClient } from './authenticated-json-client.js'
import {
  desktopControlChannel, desktopControlUrl, DesktopControlSession, isTrustedControlSender,
} from './control-session.js'

const safePreferences = {
  nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
  contextIsolation: true, sandbox: true, webSecurity: true,
  allowRunningInsecureContent: false, webviewTag: false, devTools: false,
} as const

function denySessionPrivileges(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, respond) => respond(false))
  target.setPermissionCheckHandler(() => false)
  target.on('will-download', (event) => event.preventDefault())
}

function secureWindow(window: BrowserWindow, allowed: (url: string) => boolean): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-frame-navigate', (event) => {
    if (!allowed(event.url)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event) => {
    if (!allowed(event.url)) event.preventDefault()
  })
}

export async function openDesktopNaverHost(options: Readonly<{ visible?: boolean }> = {}): Promise<BrowserWindow> {
  // No persist: prefix: provider cookies exist only for this app run, not in the user's browser.
  const providerSession = session.fromPartition(`gotgotgan-naver-${randomUUID()}`, { cache: false })
  const controlSession = session.fromPartition(`gotgotgan-control-${randomUUID()}`, { cache: false })
  denySessionPrivileges(providerSession)
  denySessionPrivileges(controlSession)
  const assets = new Map([
    ['/', { name: 'index.html', type: 'text/html; charset=utf-8' }],
    ['/main.js', { name: 'main.js', type: 'text/javascript; charset=utf-8' }],
    ['/style.css', { name: 'style.css', type: 'text/css; charset=utf-8' }],
  ])
  await controlSession.protocol.handle('gotgotgan-desktop', async (request) => {
    const url = new URL(request.url)
    const asset = assets.get(url.pathname)
    if (url.host !== 'control' || url.username !== '' || url.password !== '' ||
      url.search !== '' || asset === undefined || request.method !== 'GET') return new Response(null, { status: 404 })
    const body = await readFile(new URL(`./control/${asset.name}`, import.meta.url))
    return new Response(new Uint8Array(body), { headers: {
      'content-type': asset.type, 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
    } })
  })
  const controlWindow = new BrowserWindow({
    title: '곳곳간 · NAVER 가져오기 연결 확인', width: 660, height: 520, autoHideMenuBar: true,
    show: options.visible ?? true,
    webPreferences: { ...safePreferences, session: controlSession,
      preload: fileURLToPath(new URL('./control/preload.cjs', import.meta.url)) },
  })
  secureWindow(controlWindow, (url) => url === desktopControlUrl)
  let loginWindow: BrowserWindow | undefined
  const workflow = new DesktopControlSession({
    login: () => new Promise<void>((resolve, reject) => {
      const window = new BrowserWindow({
        title: 'NAVER 직접 로그인 · 완료 후 이 창을 닫으세요', width: 1000, height: 820,
        autoHideMenuBar: true, webPreferences: { ...safePreferences, session: providerSession },
      })
      loginWindow = window
      secureWindow(window, allowsNaverLoginNavigation)
      window.once('closed', () => { if (loginWindow === window) loginWindow = undefined; resolve() })
      // Login never attaches response/body/trace/screenshot/collection listeners or a preload.
      void window.loadURL(naverMemberPageUrl).catch(() => { reject(new Error('Login unavailable.')); window.destroy() })
    }),
    closeLogin: () => { if (loginWindow !== undefined && !loginWindow.isDestroyed()) loginWindow.close() },
    collect: (signal) => {
      // Each explicit collection owns its cumulative transport byte/request budget.
      const client = new ElectronAuthenticatedJsonClient(
        (url, init) => providerSession.fetch(url, init), allowsNaverSavedPlaceRequest,
      )
      return previewSavedLibrary({
        source: new NaverApiSavedPlaceSource(createNaverSavedPlaceCollector(), client),
        session: new NaverProviderSession(client), normalizer: new NaverSavedPlaceSnapshotNormalizer(), signal,
      })
    },
  })
  ipcMain.handle(desktopControlChannel, (event, command: unknown, ...extra: unknown[]) => {
    if (extra.length > 0 || !isTrustedControlSender({
      expectedContentsId: controlWindow.webContents.id, contentsId: event.sender.id,
      frameUrl: event.senderFrame?.url, mainFrame: event.senderFrame === event.sender.mainFrame,
    })) throw new Error('Desktop command rejected.')
    return workflow.execute(command)
  })
  controlWindow.once('closed', () => {
    workflow.close()
    ipcMain.removeHandler(desktopControlChannel)
    controlSession.protocol.unhandle('gotgotgan-desktop')
    void providerSession.closeAllConnections().catch(() => undefined)
    void providerSession.clearStorageData().catch(() => undefined)
  })
  await controlWindow.loadURL(desktopControlUrl)
  return controlWindow
}

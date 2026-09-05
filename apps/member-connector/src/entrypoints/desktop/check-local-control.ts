import type { BrowserWindow } from 'electron'
import { desktopControlUrl } from '../../adapters/browser/electron/control-session.js'

/** Fixed, local-only smoke: never opens a provider page or uses a member session. */
export async function checkLocalControl(window: BrowserWindow): Promise<void> {
  if (window.webContents.getURL() !== desktopControlUrl) throw new Error('Unexpected control location.')
  const valid = await window.webContents.executeJavaScript(`(async () => {
    if (document.title !== '곳곳간 NAVER 연결 확인' ||
        typeof window.gotgotganDesktop?.collect !== 'function' ||
        document.querySelectorAll('button').length !== 3) return false;
    const result = await window.gotgotganDesktop.collect();
    return result.state === 'error' && result.message.includes('먼저 NAVER 로그인');
  })()`)
  if (valid !== true) throw new Error('Local control smoke failed.')
}

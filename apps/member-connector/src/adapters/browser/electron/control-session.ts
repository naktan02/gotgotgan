import type { SavedLibraryPreview } from '../../../application/preview-saved-library.js'
import type { DesktopAcquisition, DesktopAcquisitionProvider } from '../../../application/ports/desktop-acquisition-provider.js'
import { confirmLogin, type DesktopLoginWindow } from './login-confirmation.js'

export const desktopControlUrl = 'gotgotgan-desktop://control/'
export const desktopControlChannel = 'gotgotgan-desktop:command'
export type DesktopCommand = 'collect' | 'cancel'
export type DesktopResult = Readonly<{ state: 'busy' | 'cancelled' | 'error'; message: string }> |
  Readonly<{ state: 'collected'; summary: SavedLibraryPreview }>

export function isTrustedControlSender(input: Readonly<{
  expectedContentsId: number; contentsId: number; frameUrl: string | undefined; mainFrame: boolean
}>): boolean {
  return input.contentsId === input.expectedContentsId && input.mainFrame && input.frameUrl === desktopControlUrl
}

/** Authentication and collection share one cancelable operation; closing a login never grants access. */
export class DesktopControlSession {
  private closed = false
  private operation: AbortController | undefined

  constructor(private readonly createProvider: () => DesktopAcquisitionProvider,
    private readonly openLogin: (provider: DesktopAcquisitionProvider) => DesktopLoginWindow,
    private readonly collect: (acquisition: DesktopAcquisition, signal: AbortSignal) => Promise<SavedLibraryPreview>) {}

  async execute(command: unknown): Promise<DesktopResult> {
    if (this.closed || (command !== 'collect' && command !== 'cancel')) {
      return { state: 'error', message: '허용되지 않은 작업입니다.' }
    }
    if (command === 'cancel') {
      this.operation?.abort()
      return { state: 'cancelled', message: '작업을 취소했습니다. 서버에는 저장하지 않았습니다.' }
    }
    if (this.operation !== undefined) return { state: 'busy', message: '진행 중인 작업을 먼저 마치거나 취소해 주세요.' }
    const controller = new AbortController()
    this.operation = controller
    const timeout = setTimeout(() => controller.abort(), 10 * 60_000)
    try {
      const provider = this.createProvider()
      const state = await provider.acquisition.session.probe({ signal: controller.signal })
      controller.signal.throwIfAborted()
      if (state === 'unavailable') throw new Error('Provider unavailable.')
      if (state === 'reauth-required') {
        await confirmLogin({ provider, window: this.openLogin(provider), signal: controller.signal })
      }
      controller.signal.throwIfAborted()
      const summary = await this.collect(provider.acquisition, controller.signal)
      controller.signal.throwIfAborted()
      return { state: 'collected', summary }
    } catch {
      return controller.signal.aborted
        ? { state: 'cancelled', message: '수집을 취소했거나 제한 시간을 넘겼습니다. 서버에는 저장하지 않았습니다.' }
        : { state: 'error', message: '인증 또는 수집을 완료하지 못했습니다. 로그인 창을 닫았거나 응답 변경·요청 제한·연결 문제가 발생했습니다. 서버에는 저장하지 않았습니다.' }
    } finally { clearTimeout(timeout); this.operation = undefined }
  }

  close(): void { this.closed = true; this.operation?.abort() }
}

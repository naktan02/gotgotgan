import type { SavedLibraryPreview } from '../../../application/preview-saved-library.js'
import { SavedPlaceSourceError } from '../../../application/ports/saved-place-source.js'

export const desktopControlUrl = 'gotgotgan-desktop://control/'
export const desktopControlChannel = 'gotgotgan-desktop:command'
export type DesktopCommand = 'login' | 'collect' | 'cancel'
export type DesktopResult = Readonly<{ state: 'login-closed' | 'busy' | 'cancelled' | 'error'; message: string }> |
  Readonly<{ state: 'collected'; summary: SavedLibraryPreview }>

export function isTrustedControlSender(input: Readonly<{
  expectedContentsId: number
  contentsId: number
  frameUrl: string | undefined
  mainFrame: boolean
}>): boolean {
  return input.contentsId === input.expectedContentsId && input.mainFrame && input.frameUrl === desktopControlUrl
}

/** Owns mutual exclusion between visible login and acquisition, plus cancellation/deadline. */
export class DesktopControlSession {
  private phase: 'idle' | 'login' | 'collect' = 'idle'
  private loginClosed = false
  private closed = false
  private cancelledLogin = false
  private collection: AbortController | undefined

  constructor(private readonly actions: Readonly<{
    login(): Promise<void>
    closeLogin(): void
    collect(signal: AbortSignal): Promise<SavedLibraryPreview>
  }>) {}

  async execute(command: unknown): Promise<DesktopResult> {
    if (this.closed || typeof command !== 'string' || !['login', 'collect', 'cancel'].includes(command)) {
      return { state: 'error', message: '허용되지 않은 작업입니다.' }
    }
    if (command === 'cancel') {
      this.collection?.abort()
      this.cancelledLogin = true
      this.actions.closeLogin()
      this.loginClosed = false
      return { state: 'cancelled', message: '작업을 취소했습니다. 다시 로그인한 뒤 수집해 주세요.' }
    }
    if (this.phase !== 'idle') return { state: 'busy', message: '진행 중인 작업을 먼저 마치거나 취소해 주세요.' }
    if (command === 'login') {
      this.phase = 'login'
      this.loginClosed = false
      this.cancelledLogin = false
      try {
        await this.actions.login()
        if (this.closed || this.cancelledLogin) return { state: 'cancelled', message: '로그인을 취소했습니다.' }
        this.loginClosed = true
        return { state: 'login-closed', message: '로그인 창을 닫았습니다. 기본 정보 수집을 누르면 인증 상태를 확인합니다.' }
      } catch { return { state: 'error', message: '로그인 창을 열지 못했습니다. 인증·보안 확인은 NAVER 화면에서 직접 진행해 주세요.' } }
      finally { this.phase = 'idle' }
    }
    if (!this.loginClosed) return { state: 'error', message: '먼저 NAVER 로그인 창에서 로그인하고 창을 닫아 주세요.' }
    this.phase = 'collect'
    const controller = new AbortController()
    this.collection = controller
    const timer = setTimeout(() => controller.abort(), 10 * 60_000)
    try {
      const summary = await this.actions.collect(controller.signal)
      controller.signal.throwIfAborted()
      return { state: 'collected', summary }
    } catch (error) {
      if (controller.signal.aborted) return { state: 'cancelled', message: '수집을 취소했거나 제한 시간을 넘겼습니다. 서버에는 저장하지 않았습니다.' }
      if (error instanceof SavedPlaceSourceError && error.code === 'reauth-required') {
        this.loginClosed = false
        return { state: 'error', message: 'NAVER 로그인이 필요합니다. 로그인·2차 인증·보안 확인은 직접 진행해 주세요.' }
      }
      return { state: 'error', message: '수집하지 못했습니다. 응답 변경·요청 제한·연결 상태를 확인한 뒤 다시 시도해 주세요. 서버에는 저장하지 않았습니다.' }
    } finally { clearTimeout(timer); this.collection = undefined; this.phase = 'idle' }
  }

  close(): void { this.closed = true; this.collection?.abort(); this.actions.closeLogin() }
}

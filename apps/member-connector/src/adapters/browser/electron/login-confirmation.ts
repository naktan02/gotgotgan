import type { DesktopAcquisitionProvider } from '../../../application/ports/desktop-acquisition-provider.js'
import { SavedPlaceSourceError } from '../../../application/ports/saved-place-source.js'

export type DesktopLoginWindow = Readonly<{
  closed: Promise<void>
  currentUrl(): string
  close(): void
}>

function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('Login interrupted.')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 3000)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export async function confirmLogin(input: Readonly<{
  provider: DesktopAcquisitionProvider
  window: DesktopLoginWindow
  signal: AbortSignal
}>): Promise<void> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 5 * 60_000)
  let verified = false
  void input.window.closed.then(() => { if (!verified) abort() }).catch(abort)
  try {
    if (input.signal.aborted) abort()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await wait(controller.signal)
      if (!input.provider.canProbeLogin(input.window.currentUrl())) continue
      const state = await input.provider.acquisition.session.probe({ signal: controller.signal })
      controller.signal.throwIfAborted()
      if (state === 'unavailable') throw new SavedPlaceSourceError('provider-unavailable', true, 'Provider unavailable.')
      if (!input.provider.canProbeLogin(input.window.currentUrl())) continue
      if (state === 'active') { verified = true; return }
    }
    throw new Error('Login confirmation expired.')
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', abort)
    controller.abort()
    input.window.close()
    await input.window.closed.catch(() => undefined)
  }
}

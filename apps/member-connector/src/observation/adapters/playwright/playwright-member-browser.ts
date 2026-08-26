import { chromium } from 'playwright'

import type {
  BrowserObservationResult,
  ObservedBrowserResponse,
  ProviderBrowserObservation,
} from '../../application/ports/provider-browser-observation.js'

type ResponseLike = Readonly<{
  url(): string
  status(): number
  headers(): Readonly<Record<string, string>>
  request(): Readonly<{ method(): string }>
  body(): Promise<Buffer>
}>

type PageLike = Readonly<{
  goto(url: string, options: Readonly<{ waitUntil: 'domcontentloaded'; timeout: number }>): Promise<unknown>
  evaluate(
    pageFunction: (url: string) => Promise<void>,
    url: string,
  ): Promise<void>
}>

interface ContextLike {
  pages(): readonly PageLike[]
  newPage(): Promise<PageLike>
  on(event: 'response', listener: (response: ResponseLike) => void): void
  on(event: 'close', listener: () => void): void
  off(event: 'response', listener: (response: ResponseLike) => void): void
  off(event: 'close', listener: () => void): void
  close(): Promise<void>
}

type LaunchPersistentContext = (
  profileRoot: string,
  options: Readonly<{
    channel: 'chrome'
    headless: false
    acceptDownloads: false
  }>,
) => Promise<ContextLike>

const defaultLaunchPersistentContext: LaunchPersistentContext = async (profileRoot, options) => (
  await chromium.launchPersistentContext(profileRoot, options) as unknown as ContextLike
)

function waitForStop(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

function waitForClose(context: ContextLike, signal: AbortSignal): Promise<'closed' | 'cancelled'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('cancelled')
      return
    }
    function done(status: 'closed' | 'cancelled') {
      context.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
      resolve(status)
    }
    function onClose() { done('closed') }
    function onAbort() { done('cancelled') }
    context.on('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function observedResponse(
  response: ResponseLike,
  allowedOrigins: ReadonlySet<string>,
  metadataHostSuffix: string,
  maximumBodyBytes: number,
): Promise<ObservedBrowserResponse | undefined> {
  try {
    const url = new URL(response.url())
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === metadataHostSuffix || url.hostname.endsWith(`.${metadataHostSuffix}`))
    ) return undefined
    const headers = response.headers()
    const contentType = headers['content-type'] ?? 'unknown'
    const declaredLength = Number(headers['content-length'])
    let body: unknown
    if (
      contentType.toLowerCase().includes('json') &&
      allowedOrigins.has(url.origin) &&
      (!Number.isFinite(declaredLength) || declaredLength <= maximumBodyBytes)
    ) {
      const bytes = await response.body()
      if (bytes.byteLength <= maximumBodyBytes) {
        try {
          body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
        } catch {
          body = undefined
        }
      }
    }
    return {
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
      contentType,
      ...(body === undefined ? {} : { body }),
    }
  } catch {
    return undefined
  }
}

export class PlaywrightMemberBrowser implements ProviderBrowserObservation {
  private readonly launchPersistentContext: LaunchPersistentContext
  private readonly now: () => Date

  constructor(private readonly configuration: Readonly<{
    profileRoot: string
    observationMilliseconds: number
    launchPersistentContext?: LaunchPersistentContext
    now?: () => Date
  }>) {
    this.launchPersistentContext = configuration.launchPersistentContext ?? defaultLaunchPersistentContext
    this.now = configuration.now ?? (() => new Date())
  }

  async openLogin(input: Readonly<{
    targetUrl: string
    requestUrl?: string
    signal: AbortSignal
  }>): Promise<Readonly<{ status: 'closed' | 'cancelled' }>> {
    const context = await this.launchPersistentContext(this.configuration.profileRoot, {
      channel: 'chrome',
      headless: false,
      acceptDownloads: false,
    })
    try {
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto(input.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return { status: await waitForClose(context, input.signal) }
    } finally {
      await context.close().catch(() => undefined)
    }
  }

  async observe(input: Readonly<{
    targetUrl: string
    requestUrl?: string
    allowedOrigins: readonly string[]
    metadataHostSuffix: string
    maximumBodyBytes: number
    signal: AbortSignal
  }>): Promise<BrowserObservationResult> {
    const startedAt = this.now().toISOString()
    const context = await this.launchPersistentContext(this.configuration.profileRoot, {
      channel: 'chrome',
      headless: false,
      acceptDownloads: false,
    })
    const pending: Promise<ObservedBrowserResponse | undefined>[] = []
    const allowedOrigins = new Set(input.allowedOrigins)
    const listener = (response: ResponseLike) => {
      if (pending.length >= 1_000) return
      pending.push(observedResponse(
        response,
        allowedOrigins,
        input.metadataHostSuffix,
        input.maximumBodyBytes,
      ))
    }
    context.on('response', listener)
    try {
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto(input.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (input.requestUrl !== undefined) {
        await page.evaluate(async (url) => {
          await fetch(url, { method: 'GET', credentials: 'include', redirect: 'manual' })
        }, input.requestUrl)
      }
      await waitForStop(this.configuration.observationMilliseconds, input.signal)
      context.off('response', listener)
      const responses = (await Promise.all(pending)).filter(
        (response): response is ObservedBrowserResponse => response !== undefined,
      )
      return {
        startedAt,
        finishedAt: this.now().toISOString(),
        responses,
      }
    } finally {
      context.off('response', listener)
      await context.close().catch(() => undefined)
    }
  }
}

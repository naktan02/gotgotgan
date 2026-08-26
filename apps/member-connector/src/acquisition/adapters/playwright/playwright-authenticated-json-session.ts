import { chromium } from 'playwright'

import type { NaverAuthenticatedJsonClient } from '../naver/naver-saved-place-collector.js'

type BrowserFetchResult =
  | Readonly<{
      kind: 'response'
      status: number
      contentType: string
      body: string
    }>
  | Readonly<{ kind: 'too-large' }>

type PageLike = Readonly<{
  goto(url: string, options: Readonly<{
    waitUntil: 'domcontentloaded'
    timeout: number
  }>): Promise<unknown>
  evaluate(
    pageFunction: (input: Readonly<{ url: string; maximumBytes: number }>) => Promise<BrowserFetchResult>,
    input: Readonly<{ url: string; maximumBytes: number }>,
  ): Promise<BrowserFetchResult>
}>

type ContextLike = Readonly<{
  pages(): readonly PageLike[]
  newPage(): Promise<PageLike>
  close(): Promise<void>
}>

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

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    function aborted() {
      signal.removeEventListener('abort', aborted)
      reject(signal.reason)
    }
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
  })
}

export class PlaywrightAuthenticatedJsonSession {
  private readonly launchPersistentContext: LaunchPersistentContext

  constructor(private readonly configuration: Readonly<{
    profileRoot: string
    allowedOrigin: string
    sessionUrl: string
    requestTimeoutMilliseconds: number
    launchPersistentContext?: LaunchPersistentContext
  }>) {
    this.launchPersistentContext = configuration.launchPersistentContext ?? defaultLaunchPersistentContext
  }

  async use<T>(operation: (client: NaverAuthenticatedJsonClient) => Promise<T>): Promise<T> {
    if (new URL(this.configuration.sessionUrl).origin !== this.configuration.allowedOrigin) {
      throw new Error('Authenticated member request is invalid')
    }
    const context = await this.launchPersistentContext(this.configuration.profileRoot, {
      channel: 'chrome',
      headless: false,
      acceptDownloads: false,
    })
    try {
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto(this.configuration.sessionUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.configuration.requestTimeoutMilliseconds,
      })
      const client: NaverAuthenticatedJsonClient = {
        get: async ({ url, maximumBytes, signal }) => {
          if (url.origin !== this.configuration.allowedOrigin || maximumBytes <= 0) {
            throw new Error('Authenticated member request is invalid')
          }
          const result = await abortable(page.evaluate(async ({ url: target, maximumBytes: limit }) => {
            const response = await fetch(target, {
              method: 'GET',
              credentials: 'include',
              redirect: 'manual',
              headers: { accept: 'application/json' },
            })
            const contentLength = Number(response.headers.get('content-length'))
            if (Number.isFinite(contentLength) && contentLength > limit) {
              return { kind: 'too-large' as const }
            }
            const body = await response.text()
            if (new TextEncoder().encode(body).byteLength > limit) {
              return { kind: 'too-large' as const }
            }
            return {
              kind: 'response' as const,
              status: response.status,
              contentType: response.headers.get('content-type') ?? 'unknown',
              body,
            }
          }, { url: url.toString(), maximumBytes }), signal)
          if (result.kind === 'too-large') {
            throw new Error('Authenticated member response is too large')
          }
          return {
            status: result.status,
            contentType: result.contentType,
            body: new TextEncoder().encode(result.body),
          }
        },
      }
      return await operation(client)
    } finally {
      await context.close().catch(() => undefined)
    }
  }
}

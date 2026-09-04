import {
  AuthenticatedJsonClientError,
  type AuthenticatedJsonClient,
} from '../../../application/ports/authenticated-json-client.js'

type OriginPermissionApi = Readonly<{
  contains(permission: Readonly<{ origins: string[] }>): Promise<boolean>
  request(permission: Readonly<{ origins: string[] }>): Promise<boolean>
}>

type ProviderTab = Readonly<{
  id?: number | undefined
  status?: string | undefined
  url?: string | undefined
}>

type ProviderTabsApi = Readonly<{
  query(query: Readonly<{ url: string[] }>): Promise<readonly ProviderTab[]>
  create(properties: Readonly<{ active: boolean; url: string }>): Promise<ProviderTab>
  get(tabId: number): Promise<ProviderTab>
}>

type ProviderPageResponse = Readonly<{
  kind: 'response'
  status: number
  contentType: string
  bodyText: string
}> | Readonly<{
  kind: 'error'
  code: 'invalid-target' | 'response-too-large' | 'request-failed'
}>

type ProviderScriptingApi = Readonly<{
  executeScript(details: Readonly<{
    target: Readonly<{ tabId: number }>
    world: 'ISOLATED'
    args: [string, number]
    func: (url: string, maximumBytes: number) => Promise<ProviderPageResponse>
  }>): Promise<readonly Readonly<{ result?: ProviderPageResponse | undefined }>[]>
}>

export class BrowserOriginPermissionDeniedError extends AuthenticatedJsonClientError {
  override readonly name = 'BrowserOriginPermissionDeniedError'

  constructor(message: string) {
    super('permission-denied', message)
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

async function requestFromProviderPage(
  url: string,
  maximumBytes: number,
): Promise<ProviderPageResponse> {
  const target = new URL(url)
  if (
    target.origin !== location.origin ||
    !Number.isInteger(maximumBytes) || maximumBytes <= 0
  ) return { kind: 'error', code: 'invalid-target' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(target.toString(), {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > maximumBytes) {
      return { kind: 'error', code: 'response-too-large' }
    }
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > maximumBytes) {
      return { kind: 'error', code: 'response-too-large' }
    }
    return {
      kind: 'response',
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bodyText: new TextDecoder('utf-8').decode(body),
    }
  } catch {
    return { kind: 'error', code: 'request-failed' }
  } finally {
    clearTimeout(timeout)
  }
}

export class WebExtensionProviderPageJsonClient implements AuthenticatedJsonClient {
  private readonly origin: string
  private readonly permissionPattern: string
  private readonly providerPageUrl: string

  constructor(
    origin: string,
    providerPageUrl: string,
    private readonly permissions: OriginPermissionApi,
    private readonly tabs: ProviderTabsApi,
    private readonly scripting: ProviderScriptingApi,
  ) {
    const parsedOrigin = new URL(origin)
    const parsedPage = new URL(providerPageUrl)
    if (
      parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin ||
      parsedPage.origin !== parsedOrigin.origin
    ) throw new Error('Provider page JSON client configuration is invalid.')
    this.origin = parsedOrigin.origin
    this.permissionPattern = `${parsedOrigin.origin}/*`
    this.providerPageUrl = parsedPage.toString()
  }

  async prepare(): Promise<void> {
    const requested = { origins: [this.permissionPattern] }
    if (
      !(await this.permissions.contains(requested)) &&
      !(await this.permissions.request(requested))
    ) throw new BrowserOriginPermissionDeniedError('Provider origin permission was denied.')
  }

  private async providerTab(signal: AbortSignal): Promise<number> {
    const matched = await this.tabs.query({ url: [`${this.origin}/*`] })
    let tab = matched.find((candidate) => candidate.id !== undefined)
    if (tab === undefined) {
      tab = await this.tabs.create({ active: false, url: this.providerPageUrl })
    }
    if (tab.id === undefined) throw new Error('Provider page tab is unavailable.')
    const tabId = tab.id

    for (let attempt = 0; tab.status !== 'complete' && attempt < 100; attempt += 1) {
      await wait(100, signal)
      tab = await this.tabs.get(tabId)
    }
    if (tab.status !== 'complete') throw new Error('Provider page is temporarily unavailable.')
    if (tab.url !== undefined && new URL(tab.url).origin !== this.origin) {
      throw new Error('Provider session requires user action')
    }
    return tabId
  }

  async get(input: Readonly<{
    url: URL
    maximumBytes: number
    signal: AbortSignal
  }>) {
    if (
      input.url.origin !== this.origin ||
      !Number.isInteger(input.maximumBytes) || input.maximumBytes <= 0
    ) throw new Error('Provider JSON request is invalid.')
    if (input.signal.aborted) throw input.signal.reason
    await this.prepare()
    const tabId = await this.providerTab(input.signal)
    const [injection] = await this.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      args: [input.url.toString(), input.maximumBytes],
      func: requestFromProviderPage,
    })
    if (input.signal.aborted) throw input.signal.reason
    const result = injection?.result
    if (result?.kind !== 'response') {
      if (result?.code === 'response-too-large') {
        throw new Error('Provider JSON response exceeded the configured limit.')
      }
      throw new Error('Provider page request is temporarily unavailable.')
    }
    return {
      status: result.status,
      contentType: result.contentType,
      body: new TextEncoder().encode(result.bodyText),
    }
  }
}

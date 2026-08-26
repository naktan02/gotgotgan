type PageTab = Readonly<{ id?: number | undefined }>

type PageTabsApi = Readonly<{
  query(query: Readonly<{ url: string[] }>): Promise<readonly PageTab[]>
}>

type PageRequestInput = Readonly<{
  url: string
  method: 'GET' | 'POST'
  headers: Readonly<Record<string, string>>
  body?: string | undefined
  credentials: 'include' | 'omit'
  redirect: 'manual'
  maximumResponseBytes: number
}>

type PageRequestResult = Readonly<{
  kind: 'response'
  status: number
  contentType: string
  bodyText: string
}> | Readonly<{
  kind: 'error'
  code: 'invalid-target' | 'request-failed' | 'response-too-large'
}>

type PageScriptingApi = Readonly<{
  executeScript(details: Readonly<{
    target: Readonly<{ tabId: number }>
    world: 'ISOLATED'
    args: [PageRequestInput, string]
    func: (input: PageRequestInput, allowedOrigin: string) => Promise<PageRequestResult>
  }>): Promise<readonly Readonly<{ result?: PageRequestResult | undefined }>[]>
}>

async function requestFromPage(
  input: PageRequestInput,
  allowedOrigin: string,
): Promise<PageRequestResult> {
  const target = new URL(input.url)
  if (
    location.origin !== allowedOrigin || target.origin !== allowedOrigin ||
    !Number.isInteger(input.maximumResponseBytes) || input.maximumResponseBytes <= 0
  ) return { kind: 'error', code: 'invalid-target' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(target.toString(), {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      credentials: input.credentials,
      redirect: input.redirect,
      cache: 'no-store',
      signal: controller.signal,
    })
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > input.maximumResponseBytes) {
      return { kind: 'error', code: 'response-too-large' }
    }
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > input.maximumResponseBytes) {
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

export class WebExtensionPageJsonRequest {
  private readonly origin: string

  constructor(
    origin: string,
    private readonly tabs: PageTabsApi,
    private readonly scripting: PageScriptingApi,
  ) {
    const parsed = new URL(origin)
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(parsed.hostname)
    if (
      parsed.origin !== origin || parsed.username !== '' || parsed.password !== '' ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    ) throw new Error('Page JSON request origin is invalid.')
    this.origin = parsed.origin
  }

  async request(input: PageRequestInput & Readonly<{ signal: AbortSignal }>) {
    if (new URL(input.url).origin !== this.origin) {
      throw new Error('Page JSON request target is invalid.')
    }
    if (input.signal.aborted) throw input.signal.reason
    const tab = (await this.tabs.query({ url: [`${this.origin}/*`] }))
      .find((candidate) => candidate.id !== undefined)
    if (tab?.id === undefined) throw new Error('Place page is unavailable.')
    const { signal: _signal, ...serializable } = input
    const [injection] = await this.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'ISOLATED',
      args: [serializable, this.origin],
      func: requestFromPage,
    })
    if (input.signal.aborted) throw input.signal.reason
    const result = injection?.result
    if (result?.kind !== 'response') {
      throw new Error(
        result?.code === 'response-too-large'
          ? 'Page JSON response exceeded the configured limit.'
          : 'Page JSON request failed.',
      )
    }
    return result
  }
}

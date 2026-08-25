export type ProviderJsonRequest = Readonly<{
  method: 'GET' | 'POST'
  url: URL
  headers: Readonly<Record<string, string>>
  body?: unknown
  timeoutMilliseconds: number
}>

export interface ProviderJsonRequester {
  request(request: ProviderJsonRequest): Promise<unknown>
}

export class ProviderRequestFailure extends Error {
  override readonly name = 'ProviderRequestFailure'

  constructor(readonly code:
    | 'PLACE_PROVIDER_AUTHENTICATION_FAILED'
    | 'PLACE_PROVIDER_RATE_LIMITED'
    | 'PLACE_PROVIDER_TIMEOUT'
    | 'PLACE_PROVIDER_RESPONSE_INVALID'
    | 'PLACE_PROVIDER_UNAVAILABLE') {
    super(code)
  }
}

type ProviderFetcher = (input: URL, init: RequestInit) => Promise<Response>

type ProviderHttpDependencies = Readonly<{
  fetcher?: ProviderFetcher
  sleep?: (milliseconds: number) => Promise<void>
}>

const retryableCodes = new Set<ProviderRequestFailure['code']>([
  'PLACE_PROVIDER_RATE_LIMITED',
  'PLACE_PROVIDER_TIMEOUT',
  'PLACE_PROVIDER_UNAVAILABLE',
])

function failureForStatus(status: number): ProviderRequestFailure {
  if (status === 401 || status === 403) {
    return new ProviderRequestFailure('PLACE_PROVIDER_AUTHENTICATION_FAILED')
  }
  if (status === 429) return new ProviderRequestFailure('PLACE_PROVIDER_RATE_LIMITED')
  if (status === 408) return new ProviderRequestFailure('PLACE_PROVIDER_TIMEOUT')
  if (status >= 400 && status < 500) {
    return new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID')
  }
  return new ProviderRequestFailure('PLACE_PROVIDER_UNAVAILABLE')
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after')
  if (retryAfter !== null && retryAfter !== undefined && /^\d+$/.test(retryAfter)) {
    return Math.min(1_000, Number(retryAfter) * 1_000)
  }
  return Math.min(1_000, 100 * (2 ** attempt))
}

function timeoutFailure(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
}

export class OfficialProviderHttpClient implements ProviderJsonRequester {
  private readonly fetcher: ProviderFetcher
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(dependencies: ProviderHttpDependencies = {}) {
    this.fetcher = dependencies.fetcher ?? fetch
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    }))
  }

  async request(request: ProviderJsonRequest): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response | undefined
      try {
        response = await this.fetcher(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(request.timeoutMilliseconds),
        })
        if (!response.ok) throw failureForStatus(response.status)
        const contentType = response.headers.get('content-type') ?? ''
        const contentLength = Number(response.headers.get('content-length') ?? '0')
        if (!contentType.toLocaleLowerCase().includes('json') || contentLength > 1_048_576) {
          throw new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID')
        }
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > 1_048_576) {
          throw new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID')
        }
        try {
          return JSON.parse(new TextDecoder().decode(bytes))
        } catch {
          throw new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID')
        }
      } catch (error) {
        const failure = error instanceof ProviderRequestFailure
          ? error
          : new ProviderRequestFailure(
            timeoutFailure(error) ? 'PLACE_PROVIDER_TIMEOUT' : 'PLACE_PROVIDER_UNAVAILABLE',
          )
        if (attempt === 1 || !retryableCodes.has(failure.code)) throw failure
        await this.sleep(retryDelay(response, attempt))
      }
    }
    throw new ProviderRequestFailure('PLACE_PROVIDER_UNAVAILABLE')
  }
}

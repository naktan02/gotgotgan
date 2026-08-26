import type { NaverAuthenticatedJsonClient } from '../../providers/naver/naver-saved-place-collector.js'

type OriginPermissionApi = Readonly<{
  contains(permission: Readonly<{ origins: string[] }>): Promise<boolean>
  request(permission: Readonly<{ origins: string[] }>): Promise<boolean>
}>

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export class BrowserOriginPermissionDeniedError extends Error {
  override readonly name = 'BrowserOriginPermissionDeniedError'
}

export class WebExtensionAuthenticatedJsonClient implements NaverAuthenticatedJsonClient {
  private readonly origin: string
  private readonly permissionPattern: string

  constructor(
    origin: string,
    private readonly permissions: OriginPermissionApi,
    private readonly request: FetchLike = globalThis.fetch,
  ) {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
      throw new Error('Provider JSON client origin must be exact HTTPS.')
    }
    this.origin = parsed.origin
    this.permissionPattern = `${parsed.origin}/*`
  }

  async prepare(): Promise<void> {
    const requested = { origins: [this.permissionPattern] }
    if (
      !(await this.permissions.contains(requested)) &&
      !(await this.permissions.request(requested))
    ) throw new BrowserOriginPermissionDeniedError('Provider origin permission was denied.')
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
    await this.prepare()
    const response = await this.request(input.url.toString(), {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: input.signal,
    })
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > input.maximumBytes) {
      throw new Error('Provider JSON response exceeded the configured limit.')
    }
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > input.maximumBytes) {
      throw new Error('Provider JSON response exceeded the configured limit.')
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
    }
  }
}

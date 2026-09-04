export type PlaceTransferJsonTransport = Readonly<{
  request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
    credentials: 'include' | 'omit'
    redirect: 'manual'
    maximumResponseBytes: number
    signal: AbortSignal
  }>): Promise<Readonly<{
    status: number
    contentType: string
    bodyText: string
  }>>
}>

export class PlaceTransferHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super('Place transfer control request was not accepted')
    this.name = 'PlaceTransferHttpError'
  }
}

type Problem = Readonly<{ code: string; retryable: boolean }>
const encoder = new TextEncoder()

function problem(value: unknown): Problem | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'string' && candidate.code.length <= 160 &&
    typeof candidate.retryable === 'boolean'
    ? { code: candidate.code, retryable: candidate.retryable }
    : null
}

function parseBody(body: string): unknown {
  try { return JSON.parse(body) } catch { return undefined }
}

export type PlaceTransferHttpLimits = Readonly<{
  maximumRequestBytes: number
  maximumResponseBytes: number
}>

export type PlaceTransferHttpChannel =
  | Readonly<{
      kind: 'member-session-bff'
      origin: string
    }>
  | Readonly<{
      kind: 'extension-capability'
      origin: string
      /** Exact runtime extension origin that the server must independently verify from Origin. */
      expectedExtensionOrigin: string
    }>

/** Fixed-origin, fixed-prefix JSON transport used by both v2 transfer control adapters. */
export class PlaceTransferHttp {
  private readonly origin: string

  constructor(
    private readonly channel: PlaceTransferHttpChannel,
    private readonly transport: PlaceTransferJsonTransport,
    private readonly limits: PlaceTransferHttpLimits,
  ) {
    const parsed = new URL(channel.origin)
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(parsed.hostname)
    if (
      parsed.origin !== channel.origin || parsed.username !== '' || parsed.password !== '' ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      !Number.isInteger(limits.maximumRequestBytes) || limits.maximumRequestBytes < 1_024 ||
      limits.maximumRequestBytes > 5_242_880 ||
      !Number.isInteger(limits.maximumResponseBytes) || limits.maximumResponseBytes < 1_024 ||
      limits.maximumResponseBytes > 1_048_576
    ) throw new Error('Place transfer HTTP configuration is invalid')
    if (channel.kind === 'extension-capability') {
      const extensionOrigin = new URL(channel.expectedExtensionOrigin)
      if (
        !new Set(['chrome-extension:', 'moz-extension:']).has(extensionOrigin.protocol) ||
        extensionOrigin.hostname === '' || extensionOrigin.username !== '' ||
        extensionOrigin.password !== '' || !new Set(['', '/']).has(extensionOrigin.pathname) ||
        extensionOrigin.search !== '' || extensionOrigin.hash !== '' ||
        `${extensionOrigin.protocol}//${extensionOrigin.host}` !== channel.expectedExtensionOrigin
      ) throw new Error('Place transfer extension origin is invalid')
    }
    this.origin = parsed.origin
  }

  async send(input: Readonly<{
    pathname: string
    method: 'GET' | 'POST'
    body?: unknown
    token?: string
    signal: AbortSignal
  }>): Promise<unknown> {
    const memberPath = input.pathname === '/api/v2/transfers/connector-import-grants'
    const capabilityPath = input.pathname.startsWith('/v2/transfers/')
    if (input.pathname.includes('?') || input.pathname.includes('#') || input.pathname.includes('..') ||
      (this.channel.kind === 'member-session-bff' && (!memberPath || input.token !== undefined)) ||
      (this.channel.kind === 'extension-capability' && (!capabilityPath || input.token === undefined))) {
      throw new Error('Place transfer HTTP path or credential boundary is invalid')
    }
    if (input.signal.aborted) throw input.signal.reason
    const target = new URL(input.pathname, this.origin)
    if (target.origin !== this.origin) throw new Error('Place transfer HTTP origin is invalid')
    const body = input.body === undefined ? undefined : JSON.stringify(input.body)
    if (body !== undefined && encoder.encode(body).byteLength > this.limits.maximumRequestBytes) {
      throw new PlaceTransferHttpError(413, 'PLACE_CONNECTOR_REQUEST_TOO_LARGE', false)
    }
    let response
    try {
      response = await this.transport.request({
        url: target.toString(),
        method: input.method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(input.token === undefined
            ? {}
            : { authorization: `PlaceConnector ${input.token}` }),
        },
        ...(body === undefined ? {} : { body }),
        credentials: this.channel.kind === 'member-session-bff' ? 'include' : 'omit',
        redirect: 'manual',
        maximumResponseBytes: this.limits.maximumResponseBytes,
        signal: input.signal,
      })
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason
      throw new PlaceTransferHttpError(503, 'PLACE_CONNECTOR_CONTROL_UNAVAILABLE', true)
    }
    const decoded = parseBody(response.bodyText)
    if (
      response.status < 200 || response.status >= 300 ||
      !response.contentType.toLowerCase().includes('json')
    ) {
      const details = problem(decoded)
      throw new PlaceTransferHttpError(
        response.status,
        details?.code ?? (response.status >= 500
          ? 'PLACE_CONNECTOR_CONTROL_UNAVAILABLE'
          : 'PLACE_CONNECTOR_CONTROL_REJECTED'),
        details?.retryable ?? response.status >= 500,
      )
    }
    if (decoded === undefined) {
      throw new PlaceTransferHttpError(502, 'PLACE_CONNECTOR_RECEIPT_INVALID', false)
    }
    return decoded
  }
}

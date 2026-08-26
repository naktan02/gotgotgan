import type { ProviderBrowserObservation } from './ports/provider-browser-observation.js'

type JsonPrimitiveShape =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'redacted'
  | 'truncated'

interface JsonObjectShape {
  readonly [key: string]: JsonShape
}

interface JsonArrayShape extends ReadonlyArray<JsonShape> {}

type JsonShape = JsonPrimitiveShape | JsonArrayShape | JsonObjectShape

export type MemberConnectorObservationReport = Readonly<{
  schemaVersion: 'place-member-connector-observation.v1'
  providerKey: 'naver'
  startedAt: string
  finishedAt: string
  responses: readonly Readonly<{
    method: string
    origin: string
    pathTemplate: string
    queryKeys: readonly string[]
    paginationParameters?: Readonly<Record<string, string | number>>
    status: number
    contentType: string
    bodyShape?: JsonShape
  }>[]
}>

const sensitiveKey = /(?:auth|account|cookie|credential|email|mobile|pass|phone|secret|session|token)/i
const dynamicKey = /(?:\d{4,}|[a-f0-9]{8,})/i
const staticKey = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const providerHostSuffix = { naver: 'naver.com' } as const

function isProviderUrl(url: URL, hostSuffix: string): boolean {
  return url.protocol === 'https:' && (
    url.hostname === hostSuffix || url.hostname.endsWith(`.${hostSuffix}`)
  )
}

function reportKey(value: string): string {
  if (sensitiveKey.test(value)) return '{sensitive}'
  if (!staticKey.test(value) || dynamicKey.test(value)) return '{dynamic-key}'
  return value
}

function shape(value: unknown, depth = 0): JsonShape {
  if (depth >= 6) return 'truncated'
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shape(value[0], depth + 1)]
  }
  if (typeof value !== 'object') return 'truncated'
  const entries = Object.entries(value).slice(0, 50).map(([key, nested]) => {
    const safeKey = reportKey(key)
    return [safeKey, safeKey === '{sensitive}' ? 'redacted' : shape(nested, depth + 1)] as const
  })
  return Object.fromEntries(entries)
}

function pathTemplate(pathname: string): string {
  const segments = pathname.split('/').map((segment) => {
    if (segment === '') return ''
    if (segment === 'api' || /^v[1-9][0-9]?$/.test(segment)) return segment
    if (/^[0-9]+$/.test(segment)) return '{number}'
    return '{segment}'
  })
  return segments.join('/')
}

function normalizedContentType(value: string): string {
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === undefined || mediaType === '' ? 'unknown' : mediaType.slice(0, 100)
}

function safePaginationParameters(url: URL): Readonly<Record<string, string | number>> | undefined {
  const result: Record<string, string | number> = {}
  for (const key of ['start', 'limit'] as const) {
    const value = url.searchParams.get(key)
    if (value !== null && /^\d{1,9}$/.test(value)) result[key] = Number(value)
  }
  for (const key of ['sort', 'folderType'] as const) {
    const value = url.searchParams.get(key)
    if (value !== null && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value)) result[key] = value
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export async function observeProviderNetwork(input: Readonly<{
  providerKey: 'naver'
  targetUrl: string
  requestUrl?: string
  allowedOrigins: readonly string[]
  maximumBodyBytes: number
  browser: ProviderBrowserObservation
  signal: AbortSignal
}>): Promise<MemberConnectorObservationReport> {
  const allowedOrigins = new Set(input.allowedOrigins)
  const observed = await input.browser.observe({
    targetUrl: input.targetUrl,
    ...(input.requestUrl === undefined ? {} : { requestUrl: input.requestUrl }),
    allowedOrigins: input.allowedOrigins,
    metadataHostSuffix: providerHostSuffix[input.providerKey],
    maximumBodyBytes: input.maximumBodyBytes,
    signal: input.signal,
  })
  const responses = observed.responses.slice(0, 1_000).flatMap((response) => {
    let url: URL
    try {
      url = new URL(response.url)
    } catch {
      return []
    }
    if (!isProviderUrl(url, providerHostSuffix[input.providerKey])) return []
    const contentType = normalizedContentType(response.contentType)
    const paginationParameters = safePaginationParameters(url)
    return [{
      method: /^[A-Z]{1,16}$/.test(response.method) ? response.method : 'UNKNOWN',
      origin: url.origin,
      pathTemplate: pathTemplate(url.pathname),
      queryKeys: [...new Set([...url.searchParams.keys()].map(reportKey))].sort().slice(0, 50),
      ...(paginationParameters === undefined ? {} : { paginationParameters }),
      status: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status
        : 0,
      contentType,
      ...(!allowedOrigins.has(url.origin) || response.body === undefined || !contentType.includes('json')
        ? {}
        : { bodyShape: shape(response.body) }),
    }]
  })
  return {
    schemaVersion: 'place-member-connector-observation.v1',
    providerKey: input.providerKey,
    startedAt: observed.startedAt,
    finishedAt: observed.finishedAt,
    responses,
  }
}

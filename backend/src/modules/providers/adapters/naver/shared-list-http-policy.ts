import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

const directSharePath = /^\/p\/favorite\/sharedPlace\/folder\/([A-Za-z0-9_-]{1,512})\/?$/u
const shortSharePath = /^\/[A-Za-z0-9_-]{1,128}\/?$/u
const allowedRedirectHosts = new Set(['naver.me', 'map.naver.com'])

const blockedIpv4Addresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4')

const blockedIpv6Addresses = new BlockList()
for (const [network, prefix] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['::ffff:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['5f00::', 16], ['fec0::', 10],
] as const) blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6')

export type NaverSharedLinkTransportFailureCode =
  | 'invalid-url'
  | 'unsupported-host'
  | 'redirect-policy-denied'
  | 'share-not-found'
  | 'share-not-readable'
  | 'provider-rate-limited'
  | 'provider-unavailable'
  | 'request-timeout'
  | 'response-too-large'

export type BoundedHttpResponse = Readonly<{
  status: number
  headers: Readonly<Record<string, string>>
  body: Uint8Array
}>

export interface NaverSharedLinkHttpClient {
  get(input: Readonly<{
    url: URL
    maximumBytes: number
    timeoutMilliseconds: number
    signal: AbortSignal
  }>): Promise<BoundedHttpResponse>
}

type AddressRecord = Readonly<{ address: string; family: number }>
type AddressLookup = (hostname: string) => Promise<readonly AddressRecord[]>
type RedirectPolicy = Readonly<{
  maximumRedirects: number
  maximumRedirectBytes: number
  timeoutMilliseconds: number
}>

export class NaverSharedLinkTransportError extends Error {
  constructor(
    readonly code: NaverSharedLinkTransportFailureCode,
    readonly retryable: boolean,
  ) {
    super(code)
  }
}

export function normalizeNaverSharedLinkUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new NaverSharedLinkTransportError('invalid-url', false)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' ||
    url.port !== '' || url.hash !== '' || url.search !== '') {
    throw new NaverSharedLinkTransportError('invalid-url', false)
  }
  url.hostname = url.hostname.toLowerCase()
  if (!allowedRedirectHosts.has(url.hostname)) {
    throw new NaverSharedLinkTransportError('unsupported-host', false)
  }
  if (url.hostname === 'naver.me' ? !shortSharePath.test(url.pathname) : !directSharePath.test(url.pathname)) {
    throw new NaverSharedLinkTransportError('invalid-url', false)
  }
  return url
}

function directShareId(url: URL): string | undefined {
  if (url.origin !== 'https://map.naver.com') return undefined
  return directSharePath.exec(url.pathname)?.[1]
}

export function responseHeader(
  response: BoundedHttpResponse,
  name: string,
): string | undefined {
  return response.headers[name.toLowerCase()]
}

export function naverSharedLinkResponseError(status: number): NaverSharedLinkTransportError {
  if (status === 404 || status === 410) return new NaverSharedLinkTransportError('share-not-found', false)
  if (status === 401 || status === 403) return new NaverSharedLinkTransportError('share-not-readable', false)
  if (status === 429) return new NaverSharedLinkTransportError('provider-rate-limited', true)
  return new NaverSharedLinkTransportError('provider-unavailable', status >= 500)
}

export async function resolveNaverShareId(
  input: URL,
  client: NaverSharedLinkHttpClient,
  signal: AbortSignal,
  options: RedirectPolicy,
): Promise<string> {
  let current = input
  for (let redirect = 0; redirect <= options.maximumRedirects; redirect += 1) {
    const direct = directShareId(current)
    if (direct !== undefined) return direct
    if (current.origin !== 'https://naver.me') {
      throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    }
    const response = await client.get({
      url: current,
      maximumBytes: options.maximumRedirectBytes,
      timeoutMilliseconds: options.timeoutMilliseconds,
      signal,
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      throw naverSharedLinkResponseError(response.status)
    }
    const location = responseHeader(response, 'location')
    if (location === undefined) throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    }
    if (next.protocol !== 'https:' || next.username !== '' || next.password !== '' ||
      next.port !== '' || next.hash !== '' || !allowedRedirectHosts.has(next.hostname.toLowerCase())) {
      throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    }
    next.hostname = next.hostname.toLowerCase()
    if (next.hostname === 'naver.me' ? !shortSharePath.test(next.pathname) : !directSharePath.test(next.pathname)) {
      throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    }
    current = next
  }
  throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
}

function publicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blockedIpv4Addresses.check(address, 'ipv4')
  if (family === 6) return !blockedIpv6Addresses.check(address, 'ipv6')
  return false
}

function lookupWithAbort(
  lookup: Promise<readonly AddressRecord[]>,
  signal: AbortSignal,
): Promise<readonly AddressRecord[]> {
  if (signal.aborted) {
    return Promise.reject(new NaverSharedLinkTransportError('request-timeout', true))
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new NaverSharedLinkTransportError('request-timeout', true))
    signal.addEventListener('abort', aborted, { once: true })
    lookup.then(
      (addresses) => {
        signal.removeEventListener('abort', aborted)
        resolve(addresses)
      },
      (error) => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
  })
}

/** HTTPS client that validates and pins DNS for every request to prevent redirect/DNS rebinding. */
export class PinnedNaverHttpsClient implements NaverSharedLinkHttpClient {
  constructor(
    private readonly lookupAddresses: AddressLookup = (hostname) =>
      dnsLookup(hostname, { all: true, verbatim: true }),
    private readonly openRequest: typeof httpsRequest = httpsRequest,
  ) {}

  async get(input: Readonly<{
    url: URL
    maximumBytes: number
    timeoutMilliseconds: number
    signal: AbortSignal
  }>): Promise<BoundedHttpResponse> {
    if (input.url.protocol !== 'https:' || input.url.port !== '') {
      throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    }
    const addresses = await lookupWithAbort(
      this.lookupAddresses(input.url.hostname), input.signal,
    )
    const pinned = addresses.find((candidate) => publicAddress(candidate.address))
    if (pinned === undefined || addresses.some((candidate) => !publicAddress(candidate.address))) {
      throw new NaverSharedLinkTransportError('redirect-policy-denied', false)
    }
    return new Promise((resolve, reject) => {
      const request = this.openRequest(input.url, {
        method: 'GET',
        headers: {
          accept: 'application/json,text/html;q=0.8',
          'user-agent': 'gotgotgan-shared-link-import/1',
        },
        lookup: (_hostname, lookupOptions, callback) => {
          if (typeof lookupOptions === 'object' && lookupOptions.all === true) {
            const allCallback = callback as unknown as (
              error: NodeJS.ErrnoException | null,
              addresses: readonly Readonly<{ address: string; family: number }>[],
            ) => void
            allCallback(null, [pinned])
            return
          }
          const singleCallback = callback as unknown as (
            error: NodeJS.ErrnoException | null,
            address: string,
            family: number,
          ) => void
          singleCallback(null, pinned.address, pinned.family)
        },
        servername: input.url.hostname,
        signal: input.signal,
      }, (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.byteLength
          if (bytes > input.maximumBytes) {
            request.destroy(new NaverSharedLinkTransportError('response-too-large', false))
            return
          }
          chunks.push(chunk)
        })
        response.once('end', () => {
          const headers: Record<string, string> = {}
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') headers[key] = value
            else if (Array.isArray(value)) headers[key] = value.join(', ')
          }
          resolve({ status: response.statusCode ?? 503, headers, body: Buffer.concat(chunks) })
        })
      })
      request.setTimeout(input.timeoutMilliseconds, () => {
        request.destroy(new NaverSharedLinkTransportError('request-timeout', true))
      })
      request.once('error', reject)
      request.end()
    })
  }
}

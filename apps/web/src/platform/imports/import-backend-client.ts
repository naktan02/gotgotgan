import type { PlaceImportBatchDetailQuery } from '@place/contracts/imports'

export type ImportBackendClientConfig = Readonly<{
  origin: string
  timeoutMilliseconds: number
  request?: (input: URL, init: RequestInit) => Promise<Response>
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function configurationError(): Error {
  return new Error('Import backend configuration is invalid')
}

export function createImportBackendClient(config: ImportBackendClientConfig) {
  let origin: URL
  try {
    origin = new URL(config.origin)
  } catch {
    throw configurationError()
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username !== '' || origin.password !== '' || origin.pathname !== '/' ||
    origin.search !== '' || origin.hash !== '' ||
    !Number.isInteger(config.timeoutMilliseconds) || config.timeoutMilliseconds <= 0 ||
    config.timeoutMilliseconds > 60_000
  ) throw configurationError()

  const request = config.request ?? fetch
  const send = (
    pathname: string,
    accessToken?: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ) => request(new URL(pathname, origin), {
    method,
    ...(accessToken === undefined ? {} : {
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMilliseconds),
  })
  const batchPath = (batchId: string, suffix = '') => {
    if (!uuidPattern.test(batchId)) throw new Error('Import batch reference is invalid')
    return `/v1/imports/${batchId}${suffix}`
  }

  return {
    ready: () => send('/readyz'),
    connections: (accessToken: string) => send('/v1/provider-connections', accessToken),
    start: (accessToken: string, body: unknown) => send('/v1/imports', accessToken, 'POST', body),
    detail: (
      accessToken: string,
      batchId: string,
      query: PlaceImportBatchDetailQuery,
    ) => {
      const parameters = new URLSearchParams({ limit: String(query.limit) })
      if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
      return send(`${batchPath(batchId)}?${parameters}`, accessToken)
    },
    cancel: (accessToken: string, batchId: string, body: unknown) =>
      send(batchPath(batchId, '/cancel'), accessToken, 'POST', body),
    resume: (accessToken: string, batchId: string, body: unknown) =>
      send(batchPath(batchId, '/resume'), accessToken, 'POST', body),
    review: (accessToken: string, body: unknown) =>
      send('/v1/import-reviews', accessToken, 'POST', body),
  }
}

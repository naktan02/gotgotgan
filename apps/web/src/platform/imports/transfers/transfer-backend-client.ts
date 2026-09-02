import type {
  ImportPlanCommandRequestV2,
  OutboundTransferCommandRequestV2,
  ProviderConnectionCommandRequestV2,
} from '@place/contracts/transfers'

export type TransferBackendClientConfig = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>
  fetcher?: (input: URL, init: RequestInit) => Promise<Response>
  timeoutMilliseconds?: number
}>

export function createTransferBackendClient(config: TransferBackendClientConfig = {}) {
  const environment = config.environment ?? process.env
  const fetcher = config.fetcher ?? fetch
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 || timeoutMilliseconds > 60_000) {
    throw new Error('Transfer backend configuration is invalid')
  }

  function send(
    pathname: string,
    accessToken: string,
    signal: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ) {
    const originValue = environment.PLACE_BACKEND_ORIGIN
    if (originValue === undefined) throw new Error('Transfer backend is unavailable')
    const origin = new URL(originValue)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username !== '' || origin.password !== '' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
      throw new Error('Transfer backend is unavailable')
    }
    return fetcher(new URL(pathname, origin), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]),
    })
  }

  return {
    capabilities: (accessToken: string, signal: AbortSignal) =>
      send('/v2/transfers/provider-capabilities', accessToken, signal),
    connections: (accessToken: string, signal: AbortSignal) =>
      send('/v2/transfers/provider-connections', accessToken, signal),
    targetLists: (accessToken: string, connectionId: string, signal: AbortSignal) =>
      send(`/v2/transfers/provider-connections/${encodeURIComponent(connectionId)}/target-lists`, accessToken, signal),
    connectionCommand: (
      accessToken: string,
      body: ProviderConnectionCommandRequestV2,
      signal: AbortSignal,
    ) => send('/v2/transfers/provider-connection-commands', accessToken, signal, 'POST', body),
    snapshots: (accessToken: string, connectionId: string, signal: AbortSignal) => {
      const query = new URLSearchParams({ connectionId, limit: '20' })
      return send(`/v2/transfers/source-snapshots?${query}`, accessToken, signal)
    },
    snapshot: (accessToken: string, snapshotId: string, signal: AbortSignal) =>
      send(`/v2/transfers/source-snapshots/${encodeURIComponent(snapshotId)}`, accessToken, signal),
    importPlanCommand: (
      accessToken: string,
      body: ImportPlanCommandRequestV2,
      signal: AbortSignal,
    ) => send('/v2/transfers/import-plan-commands', accessToken, signal, 'POST', body),
    importPlan: (accessToken: string, planId: string, signal: AbortSignal) =>
      send(`/v2/transfers/import-plans/${encodeURIComponent(planId)}`, accessToken, signal),
    outboundTransferCommand: (
      accessToken: string,
      body: OutboundTransferCommandRequestV2,
      signal: AbortSignal,
    ) => send('/v2/transfers/outbound-transfer-commands', accessToken, signal, 'POST', body),
    outboundTransfer: (accessToken: string, transferId: string, signal: AbortSignal) =>
      send(`/v2/transfers/outbound-transfers/${encodeURIComponent(transferId)}`, accessToken, signal),
  }
}

export type TransferBackendClient = ReturnType<typeof createTransferBackendClient>

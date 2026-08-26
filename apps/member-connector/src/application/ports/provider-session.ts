import type { ConnectorProviderKey } from '@place/contracts/connector'

export type ProviderSessionState = 'active' | 'reauth-required' | 'unavailable'

export interface ProviderSession {
  readonly providerKey: ConnectorProviderKey
  probe(input: Readonly<{ signal: AbortSignal }>): Promise<ProviderSessionState>
}

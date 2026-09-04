import type { ConnectorProviderKey } from '@place/contracts/connector'

/**
 * Returns only a domain-separated, keyed SHA-256 fingerprint for the active Provider account.
 * An Adapter may inspect a raw account identifier locally, but must never return, persist, or log it.
 */
export interface ProviderAccountFingerprint {
  readonly providerKey: ConnectorProviderKey
  read(input: Readonly<{ signal: AbortSignal }>): Promise<string>
}

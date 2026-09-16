import type { SavedPlaceSnapshotNormalizer } from '../import-snapshot/index.js'
import type { ProviderSession } from './provider-session.js'
import type { AuthenticatedJsonClient } from './authenticated-json-client.js'
import type { SavedPlaceSource } from './saved-place-source.js'

export type DesktopAcquisition = Readonly<{
  source: SavedPlaceSource
  session: ProviderSession
  normalizer: SavedPlaceSnapshotNormalizer
}>

/** Host policy and authenticated acquisition; no provider payload, cookie, or strategy leaks. */
export interface DesktopAcquisitionProvider {
  readonly label: string
  readonly loginUrl: string
  allowsLoginNavigation(url: string): boolean
  canProbeLogin(url: string): boolean
  readonly acquisition: DesktopAcquisition
}

export type DesktopAcquisitionProviderFactory = (
  client: (allowsRequest: (url: URL) => boolean) => AuthenticatedJsonClient,
) => DesktopAcquisitionProvider

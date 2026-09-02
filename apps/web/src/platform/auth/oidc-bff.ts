import {
  createOidcBff as createSharedOidcBff,
  type OidcBffConfig,
} from '@place/browser-auth'

import { placeWebBrowserAuthConfig } from './place-browser-auth-application'

export type {
  BrowserSession,
  BrowserSessionStore,
  OidcAuthorizationRequest,
  OidcBffConfig,
  OidcProvider,
  OidcTokenSet,
  OidcTransaction,
  OidcTransactionStore,
  ReadyOidcProvider,
} from '@place/browser-auth'

type SharedOidcBffDependencies = Parameters<typeof createSharedOidcBff>[0]
type PlaceOidcBffDependencies = Omit<SharedOidcBffDependencies, 'application'> & Readonly<{
  config: OidcBffConfig
}>

export function createOidcBff(dependencies: PlaceOidcBffDependencies) {
  return createSharedOidcBff({
    ...dependencies,
    application: placeWebBrowserAuthConfig,
  })
}

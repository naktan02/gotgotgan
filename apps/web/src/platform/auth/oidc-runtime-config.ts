import {
  loadOidcProcessRuntimeConfig as loadSharedOidcProcessRuntimeConfig,
  type BrowserAuthEnvironment,
  type LoadedOidcProcessRuntimeConfig,
} from '@place/browser-auth'

import { placeWebBrowserAuthConfig } from './place-browser-auth-application.ts'

export type {
  BrowserAuthEnvironment,
  LoadedOidcProcessRuntimeConfig,
  OidcProviderConfig,
} from '@place/browser-auth'

export function loadOidcProcessRuntimeConfig(
  environment: BrowserAuthEnvironment,
): Promise<LoadedOidcProcessRuntimeConfig> {
  return loadSharedOidcProcessRuntimeConfig(
    environment,
    placeWebBrowserAuthConfig,
  )
}

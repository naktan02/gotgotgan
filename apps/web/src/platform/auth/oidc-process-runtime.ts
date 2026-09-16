import {
  createOidcProcessRuntime as createSharedOidcProcessRuntime,
  type OidcProcessRuntimeConfig as SharedOidcProcessRuntimeConfig,
} from '@place/browser-auth'

import { placeWebBrowserAuthConfig } from './place-browser-auth-application.ts'

export type OidcDatabaseConfig = SharedOidcProcessRuntimeConfig['database']
export type OidcProcessRuntimeConfig = Omit<
  SharedOidcProcessRuntimeConfig,
  'application'
>

export function createOidcProcessRuntime(config: OidcProcessRuntimeConfig) {
  return createSharedOidcProcessRuntime({
    ...config,
    application: placeWebBrowserAuthConfig,
  })
}

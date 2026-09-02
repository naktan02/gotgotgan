import {
  createNextOidcLifecycle as createSharedNextOidcLifecycle,
  type BrowserAuthEnvironment,
  type NextOidcLifecycleDependencies,
  type OidcLifecycleInstallation,
} from '@place/browser-auth'

import {
  placeWebBrowserAuth,
  placeWebBrowserAuthConfig,
} from './place-browser-auth-application'

type PlaceNextOidcLifecycleDependencies = Omit<
  NextOidcLifecycleDependencies,
  'application'
>

export function createNextOidcLifecycle(
  dependencies: PlaceNextOidcLifecycleDependencies,
) {
  return createSharedNextOidcLifecycle({
    ...dependencies,
    application: placeWebBrowserAuthConfig,
  })
}

export function installNextOidcRuntime(
  environment: BrowserAuthEnvironment = process.env,
): Promise<OidcLifecycleInstallation> {
  return placeWebBrowserAuth.install(environment)
}

export function readNextOidcRuntime() {
  return placeWebBrowserAuth.current()
}

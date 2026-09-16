import {
  createBrowserAuthApplication,
  defineBrowserAuthApplication,
} from '@place/browser-auth'

export const placeWebBrowserAuthConfig = defineBrowserAuthApplication({
  storageNamespace: 'place.browser-auth.v1',
  environmentPrefix: 'PLACE',
  transactionCookieName: '__Host-place_oidc_tx',
  sessionCookieName: '__Host-place_session',
  lifecycleKey: 'place.web.oidc.lifecycle',
})

export const placeWebBrowserAuth = createBrowserAuthApplication(
  placeWebBrowserAuthConfig,
)

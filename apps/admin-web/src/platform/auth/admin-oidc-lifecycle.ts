import {
  createBrowserAuthApplication,
  defineBrowserAuthApplication,
} from '@place/browser-auth'

export const adminBrowserAuthApplication = defineBrowserAuthApplication({
  storageNamespace: 'place.admin-browser-auth.v1',
  environmentPrefix: 'PLACE_ADMIN',
  transactionCookieName: '__Host-place_admin_oidc_tx',
  sessionCookieName: '__Host-place_admin_session',
  lifecycleKey: 'place.admin-web.oidc.lifecycle',
})

const adminBrowserAuth = createBrowserAuthApplication(adminBrowserAuthApplication)

export function installAdminOidcRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return adminBrowserAuth.install(environment)
}

export function readAdminOidcRuntime() {
  return adminBrowserAuth.current()
}

export const adminBrowserAuthHttp = adminBrowserAuth.http

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [
    { installNextOidcRuntime },
    { installNextMembershipRuntime },
    { installNextImportRuntime },
    { installNextConnectorRuntime },
    { resolvePlaceMapStyleUrl },
  ] =
    await Promise.all([
      import('./platform/auth/next-oidc-lifecycle'),
      import('./platform/membership/next-membership-lifecycle'),
      import('./platform/imports/next-import-lifecycle'),
      import('./platform/imports/connector/runtime/next-connector-lifecycle'),
      import('./platform/maps/maplibre/map-style-config'),
    ])
  resolvePlaceMapStyleUrl(
    process.env.PLACE_MAP_STYLE_URL,
    process.env.PLACE_WEB_E2E_BASE_URL,
  )
  await Promise.all([
    installNextOidcRuntime(process.env),
    installNextMembershipRuntime(process.env),
    installNextImportRuntime(process.env),
    installNextConnectorRuntime(process.env),
  ])
}

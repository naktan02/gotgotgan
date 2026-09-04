export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [
    { installNextOidcRuntime },
    { installNextMembershipRuntime },
    { installNextImportRuntime },
    { installNextConnectorRuntime },
  ] =
    await Promise.all([
      import('./platform/auth/next-oidc-lifecycle'),
      import('./platform/membership/next-membership-lifecycle'),
      import('./platform/imports/next-import-lifecycle'),
      import('./platform/imports/connector/runtime/next-connector-lifecycle'),
    ])
  await Promise.all([
    installNextOidcRuntime(process.env),
    installNextMembershipRuntime(process.env),
    installNextImportRuntime(process.env),
    installNextConnectorRuntime(process.env),
  ])
}

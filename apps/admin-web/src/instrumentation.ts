export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { installAdminOidcRuntime } = await import('./platform/auth/admin-oidc-lifecycle')
  await installAdminOidcRuntime(process.env)
}

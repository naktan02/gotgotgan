export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { installNextOidcRuntime } = await import('./platform/auth/next-oidc-lifecycle')
  await installNextOidcRuntime(process.env)
}

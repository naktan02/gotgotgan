export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [{ installNextOidcRuntime }, { installNextMembershipRuntime }] =
    await Promise.all([
      import('./platform/auth/next-oidc-lifecycle'),
      import('./platform/membership/next-membership-lifecycle'),
    ])
  await Promise.all([
    installNextOidcRuntime(process.env),
    installNextMembershipRuntime(process.env),
  ])
}

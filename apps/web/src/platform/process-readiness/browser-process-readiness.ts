import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import { readNextMembershipRuntime } from '../membership/next-membership-lifecycle'

type Environment = Readonly<Record<string, string | undefined>>

type Dependencies = Readonly<{
  environment: Environment
  resolveOidcRuntime: () => Readonly<{ ready: () => Promise<void> }> | undefined
  resolveMembershipBackend: () =>
    | Readonly<{ ready: () => Promise<Response> }>
    | undefined
}>

function activated(environment: Environment, name: string): boolean {
  const value = environment[name]
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  throw new Error('Runtime activation is invalid')
}

function response(state: 'ok' | 'unavailable'): Response {
  return Response.json(
    { service: 'place-web', state },
    {
      status: state === 'ok' ? 200 : 503,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

export function createBrowserProcessReadiness(dependencies: Dependencies) {
  return {
    async check(): Promise<Response> {
      try {
        const oidcRequired = activated(
          dependencies.environment,
          'PLACE_OIDC_RUNTIME_ENABLED',
        )
        const membershipRequired = activated(
          dependencies.environment,
          'PLACE_MEMBERSHIP_RUNTIME_ENABLED',
        )
        const oidcRuntime = dependencies.resolveOidcRuntime()
        const membershipBackend = dependencies.resolveMembershipBackend()
        if (
          (oidcRequired && oidcRuntime === undefined) ||
          (membershipRequired && membershipBackend === undefined)
        ) {
          return response('unavailable')
        }
        const checks: Promise<unknown>[] = []
        if (oidcRequired) checks.push(oidcRuntime!.ready())
        if (membershipRequired) {
          checks.push(
            membershipBackend!.ready().then((backendResponse) => {
              if (!backendResponse.ok) throw new Error('backend unavailable')
            }),
          )
        }
        await Promise.all(checks)
        return response('ok')
      } catch {
        return response('unavailable')
      }
    },
  }
}

export const browserProcessReadiness = createBrowserProcessReadiness({
  environment: process.env,
  resolveOidcRuntime: readNextOidcRuntime,
  resolveMembershipBackend: readNextMembershipRuntime,
})

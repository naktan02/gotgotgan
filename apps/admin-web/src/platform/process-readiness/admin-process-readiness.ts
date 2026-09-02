import { processStatusSchema } from '@place/contracts/http'

import { readAdminOidcRuntime } from '../auth/admin-oidc-lifecycle'
import { createConfiguredFixedBackendClient } from '../membership/fixed-backend'

type Dependencies = Readonly<{
  resolveAuthRuntime: () => Readonly<{ ready(): Promise<void> }> | undefined
  createBackendClient: () => Readonly<{ ready(): Promise<Response> }>
}>

function status(state: 'ok' | 'unavailable'): Response {
  return Response.json(
    processStatusSchema.parse({
      schemaVersion: 'place-process-status.v1',
      service: 'place-admin-web',
      state,
    }),
    {
      status: state === 'ok' ? 200 : 503,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

export function createAdminProcessReadiness(dependencies: Dependencies) {
  return {
    async check(): Promise<Response> {
      const auth = dependencies.resolveAuthRuntime()
      if (auth === undefined) return status('unavailable')
      try {
        const backend = dependencies.createBackendClient()
        const [, backendResponse] = await Promise.all([auth.ready(), backend.ready()])
        if (!backendResponse.ok) return status('unavailable')
        return status('ok')
      } catch {
        return status('unavailable')
      }
    },
  }
}

export const adminProcessReadiness = createAdminProcessReadiness({
  resolveAuthRuntime: readAdminOidcRuntime,
  createBackendClient: () => createConfiguredFixedBackendClient(),
})

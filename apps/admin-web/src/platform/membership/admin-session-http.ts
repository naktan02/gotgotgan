import { randomUUID } from 'node:crypto'

import { adminSessionSchema, currentMembershipSchema } from '@place/contracts/http'

import { readAdminOidcRuntime } from '../auth/admin-oidc-lifecycle'

import { createConfiguredFixedBackendClient, type FixedBackendClient } from './fixed-backend'

type AdminAuthRuntime = Readonly<{
  bff: Readonly<{
    resolveSession(request: Request): Promise<
      | Readonly<{ tokens: Readonly<{ accessToken: string }> }>
      | undefined
    >
  }>
}>

type Dependencies = Readonly<{
  resolveAuthRuntime: () => AdminAuthRuntime | undefined
  createBackendClient: () => FixedBackendClient
  createCorrelationRef: () => string
}>

type AdminAuthorityRole = 'reviewer' | 'administrator' | 'owner'

const allowedRoles: ReadonlySet<string> = new Set<AdminAuthorityRole>([
  'reviewer',
  'administrator',
  'owner',
])

function headers(contentType = 'application/problem+json'): HeadersInit {
  return {
    'cache-control': 'no-store',
    'content-type': contentType,
    pragma: 'no-cache',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  }
}

function problem(
  status: 401 | 403 | 503,
  code: string,
  title: string,
  retryable: boolean,
  correlationRef: string,
): Response {
  return Response.json(
    {
      type: `urn:place:error:${code.toLowerCase().replaceAll('_', '-')}`,
      title,
      status,
      code,
      retryable,
      correlationRef,
    },
    { status, headers: headers() },
  )
}

export function createAdminSessionHttp(dependencies: Dependencies) {
  return {
    async current(request: Request): Promise<Response> {
      const correlationRef = dependencies.createCorrelationRef()
      const authRuntime = dependencies.resolveAuthRuntime()
      if (authRuntime === undefined) {
        return problem(
          503,
          'PLACE_ADMIN_AUTH_UNAVAILABLE',
          'Administrator authentication is unavailable',
          true,
          correlationRef,
        )
      }

      try {
        const session = await authRuntime.bff.resolveSession(request)
        if (session === undefined) {
          return problem(
            401,
            'PLACE_ADMIN_SESSION_REQUIRED',
            'Administrator login is required',
            false,
            correlationRef,
          )
        }
        const backend = dependencies.createBackendClient()
        const response = await backend.currentMembership(session.tokens.accessToken)
        if (response.status === 401) {
          return problem(
            401,
            'PLACE_ADMIN_SESSION_REQUIRED',
            'Administrator login is required',
            false,
            correlationRef,
          )
        }
        if (!response.ok) {
          return problem(
            503,
            'PLACE_ADMIN_BACKEND_UNAVAILABLE',
            'Administrator Backend is unavailable',
            true,
            correlationRef,
          )
        }
        const parsed = currentMembershipSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('Current membership response is invalid')
        if (!allowedRoles.has(parsed.data.authorityRole)) {
          return problem(
            403,
            'PLACE_ADMIN_AUTHORITY_REQUIRED',
            'Administrator authority is required',
            false,
            correlationRef,
          )
        }
        return Response.json(
          adminSessionSchema.parse({
            schemaVersion: 'place-admin-session.v1',
            authorityRole: parsed.data.authorityRole,
            userGrade: parsed.data.userGrade,
            productTier: parsed.data.productTier,
          }),
          { status: 200, headers: headers('application/json') },
        )
      } catch {
        return problem(
          503,
          'PLACE_ADMIN_BACKEND_UNAVAILABLE',
          'Administrator Backend is unavailable',
          true,
          correlationRef,
        )
      }
    },
  }
}

export const adminSessionHttp = createAdminSessionHttp({
  resolveAuthRuntime: readAdminOidcRuntime,
  createBackendClient: () => createConfiguredFixedBackendClient(),
  createCorrelationRef: randomUUID,
})

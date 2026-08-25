import { randomUUID } from 'node:crypto'

import type { createOidcBff } from '../auth/oidc-bff'
import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import type { createMembershipBackendClient } from './membership-backend-client'
import { readNextMembershipRuntime } from './next-membership-lifecycle'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>

type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  resolveMembershipBackend: () =>
    | ReturnType<typeof createMembershipBackendClient>
    | undefined
  createCorrelationRef: () => string
}>

const roles = new Set(['member', 'reviewer', 'administrator', 'owner'])

function problem(
  status: 400 | 401 | 409 | 503,
  code: string,
  title: string,
  correlationRef: string,
): Response {
  return Response.json(
    {
      type: `urn:place:error:${code
        .toLowerCase()
        .replace(/^place_/, '')
        .replaceAll('_', '-')}`,
      title,
      status,
      code,
      retryable: status === 409 || status === 503,
      correlationRef,
    },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/problem+json',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

function validConsent(value: unknown): value is Readonly<{ document: string; version: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 2 &&
    'document' in value &&
    'version' in value &&
    typeof value.document === 'string' &&
    value.document.length > 0 &&
    value.document.length <= 128 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    value.version.length <= 128
  )
}

function acceptedConsents(
  value: unknown,
): readonly Readonly<{ document: string; version: string }>[] | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 1 ||
    !('acceptedConsents' in value) ||
    !Array.isArray(value.acceptedConsents) ||
    value.acceptedConsents.length === 0 ||
    value.acceptedConsents.length > 32 ||
    !value.acceptedConsents.every(validConsent)
  ) {
    return undefined
  }
  return value.acceptedConsents
}

function safeSuccess(value: unknown): unknown | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('status' in value) ||
    !['created', 'existing'].includes(String(value.status)) ||
    !('membershipId' in value) ||
    typeof value.membershipId !== 'string' ||
    !('authorityRole' in value) ||
    !roles.has(String(value.authorityRole)) ||
    !('userGrade' in value) ||
    typeof value.userGrade !== 'string' ||
    !('productTier' in value) ||
    typeof value.productTier !== 'string'
  ) {
    return undefined
  }
  return {
    status: value.status,
    membershipId: value.membershipId,
    authorityRole: value.authorityRole,
    userGrade: value.userGrade,
    productTier: value.productTier,
  }
}

export function createBrowserMembershipHttp(dependencies: Dependencies) {
  const unavailable = () =>
    problem(
      503,
      'PLACE_MEMBERSHIP_WEB_UNAVAILABLE',
      'Membership is temporarily unavailable',
      dependencies.createCorrelationRef(),
    )
  return {
    async currentConsents(): Promise<Response> {
      const backend = dependencies.resolveMembershipBackend()
      if (backend === undefined) return unavailable()
      try {
        const response = await backend.currentConsents()
        const value: unknown = await response.json()
        if (
          response.status !== 200 ||
          typeof value !== 'object' ||
          value === null ||
          !('consents' in value) ||
          !Array.isArray(value.consents) ||
          !value.consents.every(validConsent)
        ) {
          return unavailable()
        }
        return Response.json(
          { consents: value.consents },
          {
            headers: {
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            },
          },
        )
      } catch {
        return unavailable()
      }
    },
    async onboard(request: Request): Promise<Response> {
      const authRuntime = dependencies.resolveAuthRuntime()
      const backend = dependencies.resolveMembershipBackend()
      if (authRuntime === undefined || backend === undefined) return unavailable()
      let session
      try {
        session = await authRuntime.bff.resolveSession(request)
      } catch {
        return unavailable()
      }
      if (session === undefined) {
        return problem(
          401,
          'PLACE_AUTHENTICATION_REQUIRED',
          'Authentication required',
          dependencies.createCorrelationRef(),
        )
      }
      let value: unknown
      try {
        value = await request.json()
      } catch {
        return problem(
          400,
          'PLACE_ONBOARDING_REQUEST_INVALID',
          'Membership onboarding request is invalid',
          dependencies.createCorrelationRef(),
        )
      }
      const consents = acceptedConsents(value)
      if (consents === undefined) {
        return problem(
          400,
          'PLACE_ONBOARDING_REQUEST_INVALID',
          'Membership onboarding request is invalid',
          dependencies.createCorrelationRef(),
        )
      }
      try {
        const response = await backend.onboard(
          session.tokens.accessToken,
          { acceptedConsents: consents },
        )
        const body: unknown = await response.json()
        const success = safeSuccess(body)
        if ((response.status === 200 || response.status === 201) && success !== undefined) {
          return Response.json(success, {
            status: response.status,
            headers: {
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            },
          })
        }
        if (response.status === 409) {
          return problem(
            409,
            'PLACE_MEMBERSHIP_CONSENT_REQUIRED',
            'Current membership consent is required',
            dependencies.createCorrelationRef(),
          )
        }
        return unavailable()
      } catch {
        return unavailable()
      }
    },
  }
}

export const browserMembershipHttp = createBrowserMembershipHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  resolveMembershipBackend: readNextMembershipRuntime,
  createCorrelationRef: randomUUID,
})

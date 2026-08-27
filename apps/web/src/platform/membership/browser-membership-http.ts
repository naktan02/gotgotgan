import { randomUUID } from 'node:crypto'

import {
  currentMembershipConsentsSchema,
  membershipOnboardingRequestSchema,
  membershipOnboardingResultSchema,
} from '@place/contracts/http'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function consentProjection(value: unknown) {
  if (!isRecord(value)) return undefined
  return currentMembershipConsentsSchema.safeParse({
    schemaVersion: value.schemaVersion,
    consents: value.consents,
  }).data
}

function onboardingProjection(value: unknown) {
  if (!isRecord(value)) return undefined
  return membershipOnboardingResultSchema.safeParse({
    schemaVersion: value.schemaVersion,
    status: value.status,
    membershipId: value.membershipId,
    authorityRole: value.authorityRole,
    userGrade: value.userGrade,
    productTier: value.productTier,
  }).data
}

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
        const consents = consentProjection(value)
        if (response.status !== 200 || consents === undefined) return unavailable()
        return Response.json(
          consents,
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
      const onboarding = membershipOnboardingRequestSchema.safeParse(value)
      if (!onboarding.success) {
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
          onboarding.data,
        )
        const body: unknown = await response.json()
        const success = onboardingProjection(body)
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

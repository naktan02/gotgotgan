import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  completeMembershipOnboarding,
  MembershipConsentRequiredError,
  type MembershipOnboardingPolicy,
} from '../../application/complete-membership-onboarding.js'
import { changeMembershipAuthorityRole } from '../../application/change-membership-authority-role.js'
import {
  authorizeAndAudit,
  resolveAccessSubject,
  UnregisteredPrincipalError,
} from '../../application/resolve-access.js'
import type { AccessAuditSink } from '../../application/ports/access-audit-sink.js'
import type { AuthorityRoleChangeStore } from '../../application/ports/authority-role-change-store.js'
import type { MembershipDirectory } from '../../application/ports/membership-directory.js'
import type { MembershipOnboardingStore } from '../../application/ports/membership-onboarding-store.js'
import type { PrincipalVerifier } from '../../application/ports/principal-verifier.js'
import { authorityRoles } from '../../domain/model.js'

const onboardingRequestSchema = z
  .object({
    acceptedConsents: z
      .array(
        z
          .object({
            document: z.string().trim().min(1).max(128),
            version: z.string().trim().min(1).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()

const authorityRoleChangeRequestSchema = z
  .object({ nextRole: z.enum(authorityRoles) })
  .strict()
const membershipPathSchema = z.object({ membershipId: z.string().uuid() })

export type AccessHttpDependencies = Readonly<{
  principalVerifier: PrincipalVerifier
  membershipDirectory: MembershipDirectory
  auditSink: AccessAuditSink
  onboarding?: Readonly<{
    policy: MembershipOnboardingPolicy
    store: MembershipOnboardingStore
    nextMembershipId: () => string
  }>
  authorityManagement?: Readonly<{ store: AuthorityRoleChangeStore }>
  now: () => Date
}>

type Problem = Readonly<{
  type: string
  title: string
  status: number
  code: string
  retryable: boolean
  correlationRef: string
}>

function sendProblem(
  reply: FastifyReply,
  problem: Problem,
  authenticate = false,
): FastifyReply {
  if (authenticate) reply.header('WWW-Authenticate', 'Bearer')
  return reply
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .type('application/problem+json')
    .status(problem.status)
    .send(problem)
}

function authenticationRequired(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const problem: Problem = {
    type: 'urn:place:error:authentication-required',
    title: 'Authentication required',
    status: 401,
    code: 'PLACE_AUTHENTICATION_REQUIRED',
    retryable: false,
    correlationRef: request.id,
  }
  return sendProblem(reply, problem, true)
}

function membershipRequired(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem: Problem = {
    type: 'urn:place:error:membership-required',
    title: 'Place membership required',
    status: 403,
    code: 'PLACE_MEMBERSHIP_REQUIRED',
    retryable: false,
    correlationRef: request.id,
  }
  return sendProblem(reply, problem)
}

function accessDenied(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem: Problem = {
    type: 'urn:place:error:access-denied',
    title: 'Access denied',
    status: 403,
    code: 'PLACE_ACCESS_DENIED',
    retryable: false,
    correlationRef: request.id,
  }
  return sendProblem(reply, problem)
}

function invalidOnboardingRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const problem: Problem = {
    type: 'urn:place:error:onboarding-request-invalid',
    title: 'Membership onboarding request is invalid',
    status: 400,
    code: 'PLACE_ONBOARDING_REQUEST_INVALID',
    retryable: false,
    correlationRef: request.id,
  }
  return sendProblem(reply, problem)
}

function membershipConsentRequired(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const problem: Problem = {
    type: 'urn:place:error:membership-consent-required',
    title: 'Current membership consent is required',
    status: 409,
    code: 'PLACE_MEMBERSHIP_CONSENT_REQUIRED',
    retryable: true,
    correlationRef: request.id,
  }
  return sendProblem(reply, problem)
}

function membershipOnboardingUnavailable(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const problem: Problem = {
    type: 'urn:place:error:membership-onboarding-unavailable',
    title: 'Membership onboarding is temporarily unavailable',
    status: 503,
    code: 'PLACE_MEMBERSHIP_ONBOARDING_UNAVAILABLE',
    retryable: true,
    correlationRef: request.id,
  }
  return sendProblem(reply, problem)
}

function accessProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: 400 | 404 | 409 | 503,
  code: string,
  title: string,
  retryable: boolean,
): FastifyReply {
  return sendProblem(reply, {
    type: `urn:place:error:${code
      .toLowerCase()
      .replace(/^place_/, '')
      .replaceAll('_', '-')}`,
    title,
    status,
    code,
    retryable,
    correlationRef: request.id,
  })
}

async function verifyBearerPrincipal(
  request: FastifyRequest,
  verifier: PrincipalVerifier,
) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')
  if (match === null) return undefined
  try {
    return await verifier.verify(match[1]!)
  } catch {
    return undefined
  }
}

export function registerAccessHttpRoutes(
  application: FastifyInstance,
  dependencies: AccessHttpDependencies,
): void {
  application.get('/v1/me', async (request, reply) => {
    const principal = await verifyBearerPrincipal(request, dependencies.principalVerifier)
    if (principal === undefined) return authenticationRequired(request, reply)
    let subject
    try {
      subject = await resolveAccessSubject(principal, dependencies.membershipDirectory)
    } catch (error) {
      if (error instanceof UnregisteredPrincipalError) return membershipRequired(request, reply)
      throw error
    }
    const decision = await authorizeAndAudit({
      subject,
      request: { permission: 'library.read' },
      auditSink: dependencies.auditSink,
      now: dependencies.now,
    })
    if (!decision.allowed) return accessDenied(request, reply)
    if (subject.kind !== 'member') return authenticationRequired(request, reply)
    return reply.status(200).send({
      membershipId: subject.membership.id,
      authorityRole: subject.membership.authorityRole,
      userGrade: subject.membership.userGrade,
      productTier: subject.membership.productTier,
    })
  })

  const onboarding = dependencies.onboarding
  if (onboarding !== undefined) {
    application.get('/v1/membership-consents/current', async (request, reply) => {
      const consents = onboardingRequestSchema.safeParse({
        acceptedConsents: onboarding.policy.requiredConsents,
      })
      if (!consents.success) {
        return accessProblem(
          request,
          reply,
          503,
          'PLACE_MEMBERSHIP_ONBOARDING_UNAVAILABLE',
          'Membership onboarding is temporarily unavailable',
          true,
        )
      }
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .status(200)
        .send({ consents: consents.data.acceptedConsents })
    })

    application.post(
      '/v1/memberships/onboarding',
      {
        errorHandler: (error, request, reply) => {
          if (
            error.statusCode !== undefined &&
            error.statusCode >= 400 &&
            error.statusCode < 500
          ) {
            return invalidOnboardingRequest(request, reply)
          }
          return membershipOnboardingUnavailable(request, reply)
        },
      },
      async (request, reply) => {
        const principal = await verifyBearerPrincipal(request, dependencies.principalVerifier)
        if (principal === undefined) return authenticationRequired(request, reply)
        const body = onboardingRequestSchema.safeParse(request.body)
        if (!body.success) return invalidOnboardingRequest(request, reply)
        let result
        try {
          result = await completeMembershipOnboarding({
            principal,
            acceptedConsents: body.data.acceptedConsents,
            policy: onboarding.policy,
            store: onboarding.store,
            nextMembershipId: onboarding.nextMembershipId,
            now: dependencies.now,
          })
        } catch (error) {
          if (error instanceof MembershipConsentRequiredError) {
            return membershipConsentRequired(request, reply)
          }
          return membershipOnboardingUnavailable(request, reply)
        }
        return reply
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .status(result.status === 'created' ? 201 : 200)
          .send({
            status: result.status,
            membershipId: result.membership.id,
            authorityRole: result.membership.authorityRole,
            userGrade: result.membership.userGrade,
            productTier: result.membership.productTier,
          })
      },
    )
  }

  const authorityManagement = dependencies.authorityManagement
  if (authorityManagement !== undefined) {
    application.patch(
      '/v1/administration/memberships/:membershipId/authority-role',
      {
        errorHandler: (error, request, reply) =>
          error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500
            ? accessProblem(
                request,
                reply,
                400,
                'PLACE_AUTHORITY_REQUEST_INVALID',
                'Authority change request is invalid',
                false,
              )
            : accessProblem(
                request,
                reply,
                503,
                'PLACE_AUTHORITY_CHANGE_UNAVAILABLE',
                'Authority change is temporarily unavailable',
                true,
              ),
      },
      async (request, reply) => {
        const principal = await verifyBearerPrincipal(request, dependencies.principalVerifier)
        if (principal === undefined) return authenticationRequired(request, reply)
        const params = membershipPathSchema.safeParse(request.params)
        const body = authorityRoleChangeRequestSchema.safeParse(request.body)
        if (!params.success || !body.success) {
          return accessProblem(
            request,
            reply,
            400,
            'PLACE_AUTHORITY_REQUEST_INVALID',
            'Authority change request is invalid',
            false,
          )
        }
        let actor
        try {
          actor = await resolveAccessSubject(principal, dependencies.membershipDirectory)
        } catch (error) {
          if (error instanceof UnregisteredPrincipalError) return accessDenied(request, reply)
          return accessProblem(
            request,
            reply,
            503,
            'PLACE_AUTHORITY_CHANGE_UNAVAILABLE',
            'Authority change is temporarily unavailable',
            true,
          )
        }
        let result
        try {
          result = await changeMembershipAuthorityRole({
            actor,
            targetMembershipId: params.data.membershipId,
            nextRole: body.data.nextRole,
            store: authorityManagement.store,
            auditSink: dependencies.auditSink,
            now: dependencies.now,
          })
        } catch {
          return accessProblem(
            request,
            reply,
            503,
            'PLACE_AUTHORITY_CHANGE_UNAVAILABLE',
            'Authority change is temporarily unavailable',
            true,
          )
        }
        if (result.status === 'forbidden') return accessDenied(request, reply)
        if (result.status === 'not-found') {
          return accessProblem(
            request,
            reply,
            404,
            'PLACE_MEMBERSHIP_NOT_FOUND',
            'Membership not found',
            false,
          )
        }
        if (result.status === 'last-owner-protected') {
          return accessProblem(
            request,
            reply,
            409,
            'PLACE_LAST_OWNER_PROTECTED',
            'The final active owner is protected',
            false,
          )
        }
        if (result.status === 'conflict') {
          return accessProblem(
            request,
            reply,
            409,
            'PLACE_AUTHORITY_CHANGE_CONFLICT',
            'Membership authority changed concurrently',
            true,
          )
        }
        return reply
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .status(200)
          .send(
            result.status === 'changed'
              ? {
                  status: result.status,
                  membershipId: result.targetMembershipId,
                  previousRole: result.previousRole,
                  authorityRole: result.nextRole,
                }
              : {
                  status: result.status,
                  membershipId: result.targetMembershipId,
                  authorityRole: body.data.nextRole,
                },
          )
      },
    )
  }
}

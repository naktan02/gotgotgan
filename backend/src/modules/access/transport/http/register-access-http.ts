import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  authorizeAndAudit,
  resolveAccessSubject,
  UnregisteredPrincipalError,
} from '../../application/resolve-access.js'
import type { AccessAuditSink } from '../../application/ports/access-audit-sink.js'
import type { MembershipDirectory } from '../../application/ports/membership-directory.js'
import type { PrincipalVerifier } from '../../application/ports/principal-verifier.js'

export type AccessHttpDependencies = Readonly<{
  principalVerifier: PrincipalVerifier
  membershipDirectory: MembershipDirectory
  auditSink: AccessAuditSink
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
  return reply.header('WWW-Authenticate', 'Bearer').status(401).send(problem)
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
  return reply.status(403).send(problem)
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
  return reply.status(403).send(problem)
}

export function registerAccessHttpRoutes(
  application: FastifyInstance,
  dependencies: AccessHttpDependencies,
): void {
  application.get('/v1/me', async (request, reply) => {
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')
    if (match === null) {
      return authenticationRequired(request, reply)
    }
    let principal
    try {
      principal = await dependencies.principalVerifier.verify(match[1]!)
    } catch {
      return authenticationRequired(request, reply)
    }
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
}

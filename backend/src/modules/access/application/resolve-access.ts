import { decideAccess, type AccessDecision, type AccessRequest } from '../domain/authorization.js'
import type { AccessSubject, ExternalPrincipal } from '../domain/model.js'
import type { AccessAuditSink } from './ports/access-audit-sink.js'
import type { MembershipDirectory } from './ports/membership-directory.js'

export class UnregisteredPrincipalError extends Error {
  constructor() {
    super('The verified principal has no Place membership.')
    this.name = 'UnregisteredPrincipalError'
  }
}

export async function resolveAccessSubject(
  principal: ExternalPrincipal | undefined,
  directory: MembershipDirectory,
): Promise<AccessSubject> {
  if (principal === undefined) return { kind: 'anonymous' }
  const membership = await directory.findByPrincipal(principal)
  if (membership === undefined) throw new UnregisteredPrincipalError()
  return { kind: 'member', membership }
}

export async function authorizeAndAudit(input: Readonly<{
  subject: AccessSubject
  request: AccessRequest
  auditSink: AccessAuditSink
  now: () => Date
}>): Promise<AccessDecision> {
  const decision = decideAccess(input.subject, input.request)
  await input.auditSink.record({
    occurredAt: input.now().toISOString(),
    subjectKind: input.subject.kind,
    request: input.request,
    decision,
  })
  return decision
}

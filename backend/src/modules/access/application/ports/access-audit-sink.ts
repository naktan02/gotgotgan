import type { AccessDecision, AccessRequest } from '../../domain/authorization.js'
import type { AccessSubject } from '../../domain/model.js'

export type AccessAuditEvent = Readonly<{
  occurredAt: string
  subjectKind: AccessSubject['kind']
  request: AccessRequest
  decision: AccessDecision
}>

export interface AccessAuditSink {
  record(event: AccessAuditEvent): Promise<void>
}

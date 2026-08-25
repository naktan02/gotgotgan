import type { Membership } from '../../domain/model.js'

export type InitialOwnerAttempt = Readonly<{
  membership: Membership
  occurredAt: string
  operatorReference: string
}>

export interface InitialOwnerStore {
  attemptAndAuditWhenNoMembershipExists(
    attempt: InitialOwnerAttempt,
  ): Promise<'created' | 'already-initialized'>
}

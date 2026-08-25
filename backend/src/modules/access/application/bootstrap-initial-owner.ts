import type {
  ExternalPrincipal,
  Membership,
  ProductTier,
  UserGrade,
} from '../domain/model.js'
import type { BootstrapAuthority } from './ports/bootstrap-authority.js'
import type { InitialOwnerStore } from './ports/initial-owner-store.js'

export class MembershipAlreadyInitializedError extends Error {
  constructor() {
    super('Place membership has already been initialized.')
    this.name = 'MembershipAlreadyInitializedError'
  }
}

export async function bootstrapInitialOwner(input: Readonly<{
  principal: ExternalPrincipal
  userGrade: UserGrade
  productTier: ProductTier
  authority: BootstrapAuthority
  store: InitialOwnerStore
  nextMembershipId: () => string
  now: () => Date
}>): Promise<Membership> {
  const authority = await input.authority.verify()
  const membership: Membership = {
    id: input.nextMembershipId(),
    principal: input.principal,
    status: 'active',
    authorityRole: 'owner',
    userGrade: input.userGrade,
    productTier: input.productTier,
    resourceGrants: [],
  }
  const result = await input.store.attemptAndAuditWhenNoMembershipExists({
    membership,
    occurredAt: input.now().toISOString(),
    operatorReference: authority.operatorReference,
  })
  if (result === 'already-initialized') throw new MembershipAlreadyInitializedError()
  return membership
}

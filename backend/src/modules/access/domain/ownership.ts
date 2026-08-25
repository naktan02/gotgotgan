export type OwnershipChange = Readonly<{
  activeOwnerCount: number
  targetCurrentRole: 'member' | 'reviewer' | 'administrator' | 'owner'
  targetNextRole?: 'member' | 'reviewer' | 'administrator' | 'owner'
  suspendTarget?: boolean
}>

export type OwnershipDecision = Readonly<{
  allowed: boolean
  reason: 'owner-remains' | 'last-owner-protected'
}>

export function decideOwnershipChange(change: OwnershipChange): OwnershipDecision {
  const removesOwner =
    change.targetCurrentRole === 'owner' &&
    (change.suspendTarget === true || change.targetNextRole !== 'owner')

  if (removesOwner && change.activeOwnerCount <= 1) {
    return { allowed: false, reason: 'last-owner-protected' }
  }
  return { allowed: true, reason: 'owner-remains' }
}

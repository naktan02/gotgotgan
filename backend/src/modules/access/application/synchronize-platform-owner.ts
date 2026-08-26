import type { ExternalPrincipal } from '../domain/model.js'
import type { PlatformEntitlementEvidence } from './ports/platform-entitlement-source.js'
import type {
  PlatformOwnerProjectionOutcome,
  PlatformOwnerProjectionStore,
} from './ports/platform-owner-projection-store.js'

export async function synchronizePlatformOwner(input: Readonly<{
  principal: ExternalPrincipal
  evidence: PlatformEntitlementEvidence
  store: PlatformOwnerProjectionStore
  now: () => Date
}>): Promise<PlatformOwnerProjectionOutcome> {
  const now = input.now()
  if (new Date(input.evidence.expiresAt).getTime() <= now.getTime()) {
    throw new Error('Platform entitlement evidence has expired.')
  }
  return input.store.synchronizePlatformOwner({
    principal: input.principal,
    evidence: input.evidence,
    occurredAt: now.toISOString(),
  })
}

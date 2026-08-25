import {
  CanonicalResolutionConflictError,
  InvalidCanonicalResolutionError,
  type CanonicalResolutionAttempt,
  type CanonicalResolutionCommand,
} from '../domain/model.js'
import { fingerprint } from './fingerprint.js'
import type { CanonicalResolutionStore } from './ports/canonical-resolution-store.js'

function validate(command: CanonicalResolutionCommand): void {
  if (command.kind === 'merge-places' && command.sourcePlaceId === command.targetPlaceId) {
    throw new InvalidCanonicalResolutionError('a Canonical Place cannot merge into itself')
  }
  if (command.kind === 'split-provider-identity' && command.sourcePlaceId === command.newPlaceId) {
    throw new InvalidCanonicalResolutionError('a split must create a distinct Canonical Place')
  }
  const identity = 'providerIdentity' in command ? command.providerIdentity : undefined
  if (identity !== undefined && (
    !/^[a-z][a-z0-9-]{0,62}$/.test(identity.providerKey) || identity.externalPlaceId.length === 0
  )) {
    throw new InvalidCanonicalResolutionError('provider identity is invalid')
  }
}

export async function applyCanonicalResolution(input: Readonly<{
  decisionId: string
  sourceDecisionId: string
  command: CanonicalResolutionCommand
  policyVersion: string
  occurredAt: string
  store: CanonicalResolutionStore
}>) {
  validate(input.command)
  if (input.decisionId.length === 0 || input.sourceDecisionId.length === 0 || input.policyVersion.length === 0) {
    throw new InvalidCanonicalResolutionError('decision and policy references are required')
  }
  const values = {
    decisionId: input.decisionId,
    sourceDecisionId: input.sourceDecisionId,
    command: input.command,
    policyVersion: input.policyVersion,
    occurredAt: input.occurredAt,
  }
  const attempt: CanonicalResolutionAttempt = { ...values, fingerprint: fingerprint(values) }
  const outcome = await input.store.apply(attempt)
  if (outcome.status === 'conflict') {
    throw new CanonicalResolutionConflictError(`decision id ${input.decisionId} conflicts with prior use`)
  }
  if (outcome.status === 'invalid') {
    throw new InvalidCanonicalResolutionError('canonical resolution command is invalid')
  }
  return outcome
}

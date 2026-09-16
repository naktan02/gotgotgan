import type {
  CanonicalFactAssertionBatch,
  CanonicalFactAssertionResult,
  CanonicalKnowledgeWriteContext,
  CanonicalProfilePublishResult,
  CanonicalProfileReadResult,
  PublishCanonicalPlaceProfile,
} from '../domain/catalog-place-knowledge.js'
import {
  InvalidCanonicalPlaceKnowledgeInputError,
  validCatalogUuid,
  validateCanonicalKnowledgeWriteContext,
  validateCatalogAssertionBatch,
  validateCatalogProfileCommand,
} from '../domain/validate-catalog-place-knowledge.js'
import { fingerprint } from './fingerprint.js'
import type { CanonicalPlaceKnowledgeStore } from './ports/catalog-place-knowledge-store.js'

function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return
    for (const child of Object.values(candidate)) freeze(child)
    Object.freeze(candidate)
  }
  freeze(copy)
  return copy
}

export type CanonicalPlaceKnowledge = ReturnType<typeof createCanonicalPlaceKnowledge>

export function createCanonicalPlaceKnowledge(store: CanonicalPlaceKnowledgeStore) {
  return {
    async assertFacts(
      input: CanonicalFactAssertionBatch,
      context: CanonicalKnowledgeWriteContext,
    ): Promise<CanonicalFactAssertionResult> {
      const batch = immutableCopy(input)
      const writeContext = immutableCopy(context)
      const issues = [
        ...validateCatalogAssertionBatch(batch),
        ...validateCanonicalKnowledgeWriteContext(writeContext),
      ]
      if (issues.length > 0) {
        return immutableCopy({
          outcome: 'rejected' as const,
          batchId: batch.batchId,
          rejection: { code: 'invalid-assertions' as const, issues },
        })
      }
      return immutableCopy(await store.appendAssertions({
        batchId: batch.batchId,
        recordedAt: batch.recordedAt,
        assertions: batch.assertions,
        actor: writeContext.actor,
        fingerprint: fingerprint({ batch, actor: writeContext.actor }),
      }))
    },

    async publishProfile(
      input: PublishCanonicalPlaceProfile,
      context: CanonicalKnowledgeWriteContext,
    ): Promise<CanonicalProfilePublishResult> {
      const command = immutableCopy(input)
      const writeContext = immutableCopy(context)
      const issues = [
        ...validateCatalogProfileCommand(command),
        ...validateCanonicalKnowledgeWriteContext(writeContext),
      ]
      if (issues.length > 0) throw new InvalidCanonicalPlaceKnowledgeInputError(issues)
      const evidenceAssertionIds = Object.freeze([...command.evidenceAssertionIds].sort())
      return immutableCopy(await store.publishProfile({
        commandId: command.commandId,
        fingerprint: fingerprint({ ...command, evidenceAssertionIds, actor: writeContext.actor }),
        placeId: command.placeId,
        expectedRevision: command.expectedRevision,
        policyVersion: command.policyVersion,
        rationale: command.rationale,
        evidenceAssertionIds,
        profile: command.profile,
        actor: writeContext.actor,
      }))
    },

    async readCurrentProfile(placeId: string): Promise<CanonicalProfileReadResult> {
      if (!validCatalogUuid(placeId)) {
        return {
          status: 'invalid',
          issues: [{ path: 'placeId', code: 'invalid-format' }],
        }
      }
      return immutableCopy(await store.readCurrentProfile(placeId))
    },
  }
}

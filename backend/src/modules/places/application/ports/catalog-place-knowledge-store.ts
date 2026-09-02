import type {
  CanonicalCurrentProfile,
  CanonicalFactAssertion,
  CanonicalFactAssertionResult,
  CanonicalKnowledgeActor,
  CanonicalPlaceProfileContent,
  CanonicalProfilePublishResult,
  CanonicalProfileReadResult,
} from '../../domain/catalog-place-knowledge.js'

export type CanonicalAssertionAppendAttempt = Readonly<{
  batchId: string
  recordedAt: string
  fingerprint: string
  assertions: readonly CanonicalFactAssertion[]
  actor: CanonicalKnowledgeActor
}>

export type CanonicalAssertionAppendStoreResult =
  | Extract<CanonicalFactAssertionResult, Readonly<{ outcome: 'accepted' }>>
  | Readonly<{
      outcome: 'rejected'
      batchId: string
      rejection:
        | Readonly<{ code: 'batch-id-reused' }>
        | Readonly<{
            code: 'subject-unavailable'
            subject: import('../../domain/catalog-place-knowledge.js').CanonicalKnowledgeSubject
          }>
    }>

export type CanonicalProfilePublishAttempt = Readonly<{
  commandId: string
  fingerprint: string
  placeId: string
  expectedRevision: number | null
  policyVersion: string
  rationale: string
  evidenceAssertionIds: readonly string[]
  profile: CanonicalPlaceProfileContent
  actor: CanonicalKnowledgeActor
}>

export interface CanonicalPlaceKnowledgeStore {
  appendAssertions(
    attempt: CanonicalAssertionAppendAttempt,
  ): Promise<CanonicalAssertionAppendStoreResult>
  publishProfile(
    attempt: CanonicalProfilePublishAttempt,
  ): Promise<CanonicalProfilePublishResult>
  readCurrentProfile(placeId: string): Promise<Exclude<
    CanonicalProfileReadResult,
    Readonly<{ status: 'invalid' }>
  >>
}

export type { CanonicalCurrentProfile }

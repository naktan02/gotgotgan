import { assessPlaceMatch } from '../domain/assess-place-match.js'
import {
  MatchAssessmentConflictError,
  PlaceEvidenceConflictError,
  type PlaceIdentityEvidence,
} from '../domain/model.js'
import { normalizePlaceIdentityEvidence } from '../domain/normalize-place-evidence.js'
import type { PlaceIdentityResolutionStore } from './ports/place-identity-resolution-store.js'

const candidatePolicy = {
  maximumDistanceMeters: 2_000,
  nameSimilarityThreshold: 0.35,
  addressSimilarityThreshold: 0.45,
} as const

export function createPlaceIdentityResolver(dependencies: Readonly<{
  store: PlaceIdentityResolutionStore
  now: () => Date
  maximumCandidates?: number
}>) {
  const maximumCandidates = dependencies.maximumCandidates ?? 50
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 100) {
    throw new Error('Place identity resolver maximumCandidates must be between one and one hundred.')
  }

  return {
    async evaluate(input: PlaceIdentityEvidence) {
      const evidence = normalizePlaceIdentityEvidence(input)
      const assessedAt = dependencies.now().toISOString()
      const indexed = await dependencies.store.indexEvidence({ evidence, indexedAt: assessedAt })
      if (indexed === 'conflict') {
        throw new PlaceEvidenceConflictError('Source observation identity was reused with different evidence.')
      }
      if (indexed === 'stale') {
        return {
          status: 'stale' as const,
          sourceObservationId: evidence.sourceObservationId,
          assessments: [],
        }
      }

      const candidates = await dependencies.store.findCandidates({
        evidence,
        maximumCandidates,
        ...candidatePolicy,
      })
      const assessments = []
      for (const candidate of [...candidates].sort((left, right) =>
        left.sourceObservationId.localeCompare(right.sourceObservationId))) {
        if (
          candidate.sourceObservationId === evidence.sourceObservationId ||
          candidate.providerIdentity.providerKey === evidence.providerIdentity.providerKey
        ) continue
        const assessment = assessPlaceMatch(evidence, candidate, assessedAt)
        const appended = await dependencies.store.appendAssessment(assessment)
        if (appended === 'conflict') {
          throw new MatchAssessmentConflictError(
            'The same evidence pair and policy produced a conflicting assessment.',
          )
        }
        assessments.push({
          comparedObservationId: candidate.sourceObservationId,
          classification: assessment.classification,
          confidence: assessment.confidence,
          reasons: assessment.reasons,
          persistence: appended,
        })
      }
      return {
        status: indexed === 'recorded' ? 'evaluated' as const : 'replayed' as const,
        sourceObservationId: evidence.sourceObservationId,
        assessments,
      }
    },
  }
}

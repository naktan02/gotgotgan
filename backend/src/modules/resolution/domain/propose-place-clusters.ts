import type {
  ClusterAssessmentEvidence,
  ClusterAssessmentReference,
  ClusterEvidenceMember,
  PlaceClusterProposal,
} from './cluster-model.js'
import {
  InvalidClusterGraphError,
  placeClusterPolicyVersion,
  placeClusterProposalVersion,
} from './cluster-model.js'
import { fingerprint } from './fingerprint.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function orderedPair(first: string, second: string): readonly [string, string] {
  return first.localeCompare(second) <= 0 ? [first, second] : [second, first]
}

function pairKey(first: string, second: string): string {
  return orderedPair(first, second).join(':')
}

function memberOrder(left: ClusterEvidenceMember, right: ClusterEvidenceMember): number {
  return left.providerIdentity.providerKey.localeCompare(right.providerIdentity.providerKey) ||
    left.providerIdentity.externalPlaceId.localeCompare(right.providerIdentity.externalPlaceId) ||
    left.sourceObservationId.localeCompare(right.sourceObservationId)
}

function assertGraph(
  members: readonly ClusterEvidenceMember[],
  assessments: readonly ClusterAssessmentEvidence[],
): void {
  const observationIds = new Set<string>()
  const providerIdentities = new Set<string>()
  for (const member of members) {
    if (observationIds.has(member.sourceObservationId)) {
      throw new InvalidClusterGraphError('Cluster evidence contains a duplicate observation.')
    }
    observationIds.add(member.sourceObservationId)
    const identityKey = `${member.providerIdentity.providerKey}:${member.providerIdentity.externalPlaceId}`
    if (providerIdentities.has(identityKey)) {
      throw new InvalidClusterGraphError('Cluster evidence contains a duplicate Provider identity.')
    }
    providerIdentities.add(identityKey)
  }

  const assessmentKeys = new Set<string>()
  for (const assessment of assessments) {
    if (
      assessment.leftObservationId === assessment.rightObservationId ||
      !observationIds.has(assessment.leftObservationId) ||
      !observationIds.has(assessment.rightObservationId)
    ) throw new InvalidClusterGraphError('Cluster assessment references invalid evidence.')
    const key = `${pairKey(assessment.leftObservationId, assessment.rightObservationId)}:${assessment.assessmentPolicyVersion}`
    if (assessmentKeys.has(key)) {
      throw new InvalidClusterGraphError('Cluster graph contains a duplicate assessment pair.')
    }
    assessmentKeys.add(key)
  }
}

function canMerge(
  left: readonly ClusterEvidenceMember[],
  right: readonly ClusterEvidenceMember[],
  assessments: ReadonlyMap<string, ClusterAssessmentEvidence>,
): boolean {
  const providerKeys = new Set(left.map((member) => member.providerIdentity.providerKey))
  if (right.some((member) => providerKeys.has(member.providerIdentity.providerKey))) return false
  return left.every((leftMember) => right.every((rightMember) =>
    assessments.get(pairKey(leftMember.sourceObservationId, rightMember.sourceObservationId))
      ?.classification === 'likely-same'))
}

function proposalFingerprint(
  members: readonly ClusterEvidenceMember[],
  assessments: readonly ClusterAssessmentReference[],
): string {
  return fingerprint({
    proposalVersion: placeClusterProposalVersion,
    clusterPolicyVersion: placeClusterPolicyVersion,
    mode: 'shadow',
    members,
    supportingAssessments: assessments,
  })
}

export function proposePlaceClusters(input: Readonly<{
  members: readonly ClusterEvidenceMember[]
  assessments: readonly ClusterAssessmentEvidence[]
  assessmentPolicyVersion: string
  proposedAt: string
  nextId: () => string
}>): readonly PlaceClusterProposal[] {
  assertGraph(input.members, input.assessments)
  const proposedAt = new Date(input.proposedAt).toISOString()
  const members = [...input.members].sort(memberOrder)
  const assessmentMap = new Map(
    input.assessments
      .filter((assessment) => assessment.assessmentPolicyVersion === input.assessmentPolicyVersion)
      .map((assessment) => [pairKey(assessment.leftObservationId, assessment.rightObservationId), assessment]),
  )
  const clusterByObservation = new Map<string, ClusterEvidenceMember[]>()
  for (const member of members) clusterByObservation.set(member.sourceObservationId, [member])

  const likelySameEdges = [...assessmentMap.values()]
    .filter((assessment) => assessment.classification === 'likely-same')
    .sort((left, right) =>
      right.confidence - left.confidence ||
      left.leftObservationId.localeCompare(right.leftObservationId) ||
      left.rightObservationId.localeCompare(right.rightObservationId))

  for (const edge of likelySameEdges) {
    const left = clusterByObservation.get(edge.leftObservationId)
    const right = clusterByObservation.get(edge.rightObservationId)
    if (left === undefined || right === undefined || left === right) continue
    if (!canMerge(left, right, assessmentMap)) continue
    const merged = [...left, ...right].sort(memberOrder)
    for (const member of merged) clusterByObservation.set(member.sourceObservationId, merged)
  }

  const clusters = [...new Set(clusterByObservation.values())]
    .sort((left, right) => memberOrder(left[0]!, right[0]!))

  return clusters.map((cluster) => {
    const supportingAssessments = [...assessmentMap.values()]
      .filter((assessment) =>
        assessment.classification === 'likely-same' &&
        cluster.some((member) => member.sourceObservationId === assessment.leftObservationId) &&
        cluster.some((member) => member.sourceObservationId === assessment.rightObservationId))
      .map<ClusterAssessmentReference>((assessment) => ({
        leftObservationId: assessment.leftObservationId,
        rightObservationId: assessment.rightObservationId,
        assessmentPolicyVersion: assessment.assessmentPolicyVersion,
        fingerprint: assessment.fingerprint,
      }))
      .sort((left, right) =>
        left.leftObservationId.localeCompare(right.leftObservationId) ||
        left.rightObservationId.localeCompare(right.rightObservationId))
    const proposalId = input.nextId()
    if (!uuidPattern.test(proposalId)) {
      throw new InvalidClusterGraphError('Place Cluster Proposal identity must be a UUID.')
    }
    return {
      proposalId,
      proposalVersion: placeClusterProposalVersion,
      clusterPolicyVersion: placeClusterPolicyVersion,
      mode: 'shadow' as const,
      members: cluster,
      supportingAssessments,
      proposedAt,
      fingerprint: proposalFingerprint(cluster, supportingAssessments),
    }
  })
}

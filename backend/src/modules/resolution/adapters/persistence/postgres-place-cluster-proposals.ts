import type { Pool, PoolClient } from 'pg'

import type {
  ClusterProposalPersistence,
  PlaceClusterProposalStore,
} from '../../application/ports/place-cluster-proposal-store.js'
import { PlaceClusterProposalConflictError } from '../../domain/cluster-model.js'
import type {
  ClusterAssessmentEvidence,
  ClusterEvidenceMember,
  PlaceClusterProposal,
} from '../../domain/cluster-model.js'

type MemberRow = Readonly<{
  source_observation_id: string
  provider_key: string
  external_place_id: string
}>

type AssessmentRow = Readonly<{
  left_observation_id: string
  right_observation_id: string
  policy_version: string
  classification: ClusterAssessmentEvidence['classification']
  confidence: string | number
  fingerprint: string
}>

type ExistingProposalRow = Readonly<{
  proposal_id: string
  proposal_version: number
  cluster_policy_version: string
  member_count: number
}>

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function insertMembers(client: PoolClient, proposal: PlaceClusterProposal): Promise<void> {
  for (const [ordinal, member] of proposal.members.entries()) {
    await client.query(
      `INSERT INTO resolution.place_cluster_members (
         proposal_id, proposal_version, member_ordinal, source_observation_id,
         provider_key, external_place_id
       ) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6)`,
      [
        proposal.proposalId,
        proposal.proposalVersion,
        ordinal,
        member.sourceObservationId,
        member.providerIdentity.providerKey,
        member.providerIdentity.externalPlaceId,
      ],
    )
  }
}

async function insertAssessmentLinks(
  client: PoolClient,
  proposal: PlaceClusterProposal,
): Promise<void> {
  for (const assessment of proposal.supportingAssessments) {
    await client.query(
      `INSERT INTO resolution.place_cluster_assessments (
         proposal_id, proposal_version, left_observation_id,
         right_observation_id, assessment_policy_version
       ) VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5)`,
      [
        proposal.proposalId,
        proposal.proposalVersion,
        assessment.leftObservationId,
        assessment.rightObservationId,
        assessment.assessmentPolicyVersion,
      ],
    )
  }
}

async function recordProposal(
  client: PoolClient,
  proposal: PlaceClusterProposal,
): Promise<ClusterProposalPersistence> {
  const inserted = await client.query<{ proposal_id: string; proposal_version: number }>(
    `INSERT INTO resolution.place_cluster_proposals (
       proposal_id, proposal_version, cluster_policy_version, mode,
       member_count, proposed_at, fingerprint
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7)
     ON CONFLICT (fingerprint) DO NOTHING
     RETURNING proposal_id, proposal_version`,
    [
      proposal.proposalId,
      proposal.proposalVersion,
      proposal.clusterPolicyVersion,
      proposal.mode,
      proposal.members.length,
      proposal.proposedAt,
      proposal.fingerprint,
    ],
  )
  const insertedRow = inserted.rows[0]
  if (insertedRow !== undefined) {
    await insertMembers(client, proposal)
    await insertAssessmentLinks(client, proposal)
    return {
      requestedProposalId: proposal.proposalId,
      proposalId: insertedRow.proposal_id,
      proposalVersion: insertedRow.proposal_version,
      status: 'recorded',
    }
  }

  const existing = await client.query<ExistingProposalRow>(
    `SELECT proposal_id, proposal_version, cluster_policy_version, member_count
     FROM resolution.place_cluster_proposals WHERE fingerprint = $1`,
    [proposal.fingerprint],
  )
  const row = existing.rows[0]
  if (
    row === undefined ||
    row.cluster_policy_version !== proposal.clusterPolicyVersion ||
    row.member_count !== proposal.members.length
  ) throw new PlaceClusterProposalConflictError('Place Cluster Proposal fingerprint conflict.')
  return {
    requestedProposalId: proposal.proposalId,
    proposalId: row.proposal_id,
    proposalVersion: row.proposal_version,
    status: 'replayed',
  }
}

export class PostgresPlaceClusterProposals implements PlaceClusterProposalStore {
  constructor(private readonly pool: Pool) {}

  async loadGraph(assessmentPolicyVersion: string) {
    const [members, assessments] = await Promise.all([
      this.pool.query<MemberRow>(
        `SELECT source_observation_id, provider_key, external_place_id
         FROM resolution.place_evidence_index
         ORDER BY provider_key, external_place_id, source_observation_id`,
      ),
      this.pool.query<AssessmentRow>(
        `SELECT assessment.left_observation_id, assessment.right_observation_id,
                assessment.policy_version, assessment.classification,
                assessment.confidence, assessment.fingerprint
         FROM resolution.match_assessments AS assessment
         JOIN resolution.place_evidence_index AS left_evidence
           ON left_evidence.source_observation_id = assessment.left_observation_id
         JOIN resolution.place_evidence_index AS right_evidence
           ON right_evidence.source_observation_id = assessment.right_observation_id
         WHERE assessment.policy_version = $1
         ORDER BY assessment.left_observation_id, assessment.right_observation_id`,
        [assessmentPolicyVersion],
      ),
    ])
    return {
      members: members.rows.map<ClusterEvidenceMember>((row) => ({
        sourceObservationId: row.source_observation_id,
        providerIdentity: {
          providerKey: row.provider_key,
          externalPlaceId: row.external_place_id,
        },
      })),
      assessments: assessments.rows.map<ClusterAssessmentEvidence>((row) => ({
        leftObservationId: row.left_observation_id,
        rightObservationId: row.right_observation_id,
        assessmentPolicyVersion: row.policy_version,
        classification: row.classification,
        confidence: Number(row.confidence),
        fingerprint: row.fingerprint,
      })),
    }
  }

  async recordProposals(proposals: readonly PlaceClusterProposal[]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const results: ClusterProposalPersistence[] = []
      for (const proposal of proposals) results.push(await recordProposal(client, proposal))
      await client.query('COMMIT')
      return results
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) {
        throw new PlaceClusterProposalConflictError('Place Cluster Proposal identity conflict.')
      }
      throw error
    } finally {
      client.release()
    }
  }
}

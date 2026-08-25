import type { Pool, PoolClient } from 'pg'

import type { CanonicalResolutionStore } from '../../application/ports/canonical-resolution-store.js'
import type {
  CanonicalPlaceResolution,
  CanonicalResolutionAttempt,
  CanonicalResolutionOutcome,
  ProviderIdentityResolution,
  ProviderPlaceIdentity,
} from '../../domain/model.js'

type OutcomeStatus = CanonicalResolutionOutcome['status']

function isMissingSourceDecision(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === '23503' &&
    'constraint' in error &&
    error.constraint === 'applied_resolution_decisions_source_decision_fkey'
}

async function placeStatus(client: PoolClient, id: string) {
  const result = await client.query<{ status: string }>(
    'SELECT status FROM places.canonical_places WHERE id = $1 FOR UPDATE', [id],
  )
  return result.rows[0]?.status
}

function resolutionResourceKeys(attempt: CanonicalResolutionAttempt): string[] {
  const command = attempt.command
  const keys: string[] = []
  if ('providerIdentity' in command) {
    keys.push(`identity:${command.providerIdentity.providerKey}:${command.providerIdentity.externalPlaceId}`)
  }
  if ('placeId' in command) keys.push(`place:${command.placeId}`)
  if ('targetPlaceId' in command) keys.push(`place:${command.targetPlaceId}`)
  if ('sourcePlaceId' in command) keys.push(`place:${command.sourcePlaceId}`)
  if ('newPlaceId' in command) keys.push(`place:${command.newPlaceId}`)
  return [...new Set(keys)].sort()
}

export class PostgresCanonicalResolutionStore implements CanonicalResolutionStore {
  constructor(private readonly pool: Pool) {}

  async apply(attempt: CanonicalResolutionAttempt): Promise<CanonicalResolutionOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('place.canonical-resolution.v1:' || $1, 0))",
        [attempt.decisionId],
      )
      for (const resourceKey of resolutionResourceKeys(attempt)) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('place.canonical-resource.v1:' || $1, 0))",
          [resourceKey],
        )
      }
      const prior = await client.query<{ command_fingerprint: string; outcome: OutcomeStatus }>(
        'SELECT command_fingerprint, outcome FROM places.applied_resolution_decisions WHERE decision_id = $1',
        [attempt.decisionId],
      )
      if (prior.rows[0] !== undefined) {
        await client.query('COMMIT')
        return prior.rows[0].command_fingerprint === attempt.fingerprint
          ? { status: 'replayed' }
          : { status: 'conflict' }
      }

      const outcome = await this.applyCommand(client, attempt)
      await client.query(
        `INSERT INTO places.applied_resolution_decisions (
           decision_id, source_decision_id, command_kind, command_fingerprint,
           outcome, command, policy_version, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [attempt.decisionId, attempt.sourceDecisionId, attempt.command.kind, attempt.fingerprint,
          outcome, attempt.command, attempt.policyVersion, attempt.occurredAt],
      )
      if (outcome === 'applied') await this.recordAppliedHistory(client, attempt)
      await client.query('COMMIT')
      return { status: outcome }
    } catch (error) {
      await client.query('ROLLBACK')
      if (isMissingSourceDecision(error)) return { status: 'invalid' }
      throw error
    } finally {
      client.release()
    }
  }

  private async applyCommand(client: PoolClient, attempt: CanonicalResolutionAttempt): Promise<Exclude<OutcomeStatus, 'replayed' | 'conflict'>> {
    const command = attempt.command
    if (command.kind === 'create-place') {
      if (await placeStatus(client, command.placeId) !== undefined) return 'invalid'
      const linked = await client.query('SELECT canonical_place_id FROM places.provider_place_identities WHERE provider_key = $1 AND external_place_id = $2 FOR UPDATE', [command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId])
      if (linked.rowCount !== 0) return 'identity-already-linked'
      await client.query('INSERT INTO places.canonical_places (id) VALUES ($1)', [command.placeId])
      await client.query(
        `INSERT INTO places.provider_place_identities (
           provider_key, external_place_id, canonical_place_id, linked_by_decision_id, linked_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId,
          command.placeId, attempt.decisionId, attempt.occurredAt],
      )
      return 'applied'
    }
    if (command.kind === 'link-provider-identity') {
      if (await placeStatus(client, command.targetPlaceId) !== 'active') return 'not-active'
      const linked = await client.query<{ canonical_place_id: string }>(
        'SELECT canonical_place_id FROM places.provider_place_identities WHERE provider_key = $1 AND external_place_id = $2 FOR UPDATE',
        [command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId],
      )
      if (linked.rows[0] !== undefined) {
        return linked.rows[0].canonical_place_id === command.targetPlaceId ? 'applied' : 'identity-already-linked'
      }
      await client.query(
        `INSERT INTO places.provider_place_identities (
           provider_key, external_place_id, canonical_place_id, linked_by_decision_id, linked_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId,
          command.targetPlaceId, attempt.decisionId, attempt.occurredAt],
      )
      return 'applied'
    }
    if (command.kind === 'merge-places') {
      const source = await placeStatus(client, command.sourcePlaceId)
      const target = await placeStatus(client, command.targetPlaceId)
      if (source === undefined || target === undefined) return 'not-found'
      if (source !== 'active' || target !== 'active') return 'not-active'
      await client.query(
        `UPDATE places.canonical_places
         SET status = 'redirected', version = version + 1, updated_at = $1
         WHERE id = $2`,
        [attempt.occurredAt, command.sourcePlaceId],
      )
      await client.query(
        `UPDATE places.provider_place_identities
         SET canonical_place_id = $1, linked_by_decision_id = $2, linked_at = $3
         WHERE canonical_place_id = $4`,
        [command.targetPlaceId, attempt.decisionId, attempt.occurredAt, command.sourcePlaceId],
      )
      return 'applied'
    }
    if (command.kind === 'split-provider-identity') {
      if (await placeStatus(client, command.sourcePlaceId) !== 'active') return 'not-active'
      if (await placeStatus(client, command.newPlaceId) !== undefined) return 'invalid'
      const linked = await client.query<{ canonical_place_id: string }>(
        'SELECT canonical_place_id FROM places.provider_place_identities WHERE provider_key = $1 AND external_place_id = $2 FOR UPDATE',
        [command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId],
      )
      if (linked.rows[0]?.canonical_place_id !== command.sourcePlaceId) return 'identity-not-linked'
      await client.query('INSERT INTO places.canonical_places (id) VALUES ($1)', [command.newPlaceId])
      await client.query(
        `UPDATE places.provider_place_identities
         SET canonical_place_id = $1, linked_by_decision_id = $2, linked_at = $3
         WHERE provider_key = $4 AND external_place_id = $5`,
        [command.newPlaceId, attempt.decisionId, attempt.occurredAt,
          command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId],
      )
      return 'applied'
    }
    const status = await placeStatus(client, command.placeId)
    if (status === undefined) return 'not-found'
    if (status !== 'active') return 'not-active'
    await client.query(
      `UPDATE places.canonical_places
       SET status = 'retired', retired_at = $1, version = version + 1, updated_at = $1
       WHERE id = $2`,
      [attempt.occurredAt, command.placeId],
    )
    return 'applied'
  }

  private async recordAppliedHistory(client: PoolClient, attempt: CanonicalResolutionAttempt) {
    const command = attempt.command
    if (command.kind === 'merge-places') {
      await client.query(
        `INSERT INTO places.canonical_place_redirects
           (source_place_id, target_place_id, decision_id, created_at)
         VALUES ($1,$2,$3,$4)`,
        [command.sourcePlaceId, command.targetPlaceId, attempt.decisionId, attempt.occurredAt],
      )
      await client.query(
        `INSERT INTO places.canonical_place_lineage_events
           (decision_id, event_kind, source_place_id, target_place_id, occurred_at)
         VALUES ($1,'merge',$2,$3,$4)`,
        [attempt.decisionId, command.sourcePlaceId, command.targetPlaceId, attempt.occurredAt],
      )
    }
    if (command.kind === 'split-provider-identity') {
      await client.query(
        `INSERT INTO places.canonical_place_lineage_events (
           decision_id, event_kind, source_place_id, target_place_id,
           provider_key, external_place_id, occurred_at
         ) VALUES ($1,'split',$2,$3,$4,$5,$6)`,
        [attempt.decisionId, command.sourcePlaceId, command.newPlaceId,
          command.providerIdentity.providerKey, command.providerIdentity.externalPlaceId,
          attempt.occurredAt],
      )
    }
  }

  async resolve(placeId: string): Promise<CanonicalPlaceResolution> {
    const result = await this.pool.query<{ id: string; status: string; redirected_from: string[] }>(
      `WITH RECURSIVE chain AS (
         SELECT id, status, ARRAY[]::uuid[] AS redirected_from
         FROM places.canonical_places WHERE id = $1
         UNION ALL
         SELECT target.id, target.status, chain.redirected_from || chain.id
         FROM chain
         JOIN places.canonical_place_redirects redirect ON redirect.source_place_id = chain.id
         JOIN places.canonical_places target ON target.id = redirect.target_place_id
         WHERE chain.status = 'redirected' AND NOT target.id = ANY(chain.redirected_from)
       )
       SELECT id, status, redirected_from FROM chain
       ORDER BY cardinality(redirected_from) DESC LIMIT 1`,
      [placeId],
    )
    const row = result.rows[0]
    if (row === undefined) return { status: 'not-found' }
    if (row.status === 'retired') {
      return { status: 'retired', placeId: row.id, redirectedFrom: row.redirected_from }
    }
    return { status: 'active', placeId: row.id, redirectedFrom: row.redirected_from }
  }

  async resolveProviderIdentity(identity: ProviderPlaceIdentity): Promise<ProviderIdentityResolution> {
    const result = await this.pool.query<{ canonical_place_id: string }>(
      `SELECT canonical_place_id FROM places.provider_place_identities
       WHERE provider_key = $1 AND external_place_id = $2`,
      [identity.providerKey, identity.externalPlaceId],
    )
    const row = result.rows[0]
    return row === undefined ? { status: 'not-found' } : { status: 'linked', placeId: row.canonical_place_id }
  }
}

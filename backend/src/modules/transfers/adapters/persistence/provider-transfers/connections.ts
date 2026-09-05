import { readOpaqueRevision } from '../../../application/identity.js'
import type {
  ProviderCapabilityV2,
  ProviderConnectionCommandRequestV2,
  ProviderConnectionObservation,
  ProviderConnectionV2,
  TransferCommandResult,
} from '../../../domain/model.js'
import {
  authMethods,
  displayNames,
  projectConnection,
  providerOrder,
  ProviderTransferContext,
  type ConnectionRow,
} from './provider-transfer-context.js'

export class ProviderConnections {
  constructor(private readonly context: ProviderTransferContext) {}

  async listCapabilities(): Promise<readonly ProviderCapabilityV2[]> {
    return providerOrder.map((providerKey) => ({
      providerKey,
      displayName: displayNames[providerKey],
      connections: (this.context.enabledConnectionAuthMethods.get(providerKey)?.size ?? 0) > 0
        ? {
            availability: 'available',
            multipleAccounts: true,
            authMethods: [...this.context.enabledConnectionAuthMethods.get(providerKey)!],
          }
        : providerKey === 'naver'
          ? { availability: 'integration-gated', multipleAccounts: true, authMethods: [] }
          : { availability: 'unavailable', multipleAccounts: true, authMethods: [] },
      importSavedPlaces: this.context.sources.has(providerKey)
        ? { availability: 'available' }
        : providerKey === 'naver'
          ? { availability: 'integration-gated', reason: 'source-adapter-unavailable' }
          : { availability: 'unavailable', reason: 'source-adapter-unavailable' },
      exportCollections: this.context.targets.has(providerKey)
        ? { availability: 'available' }
        : { availability: 'unavailable', reason: 'target-adapter-unavailable' },
    }))
  }

  async list(memberId: string): Promise<readonly ProviderConnectionV2[]> {
    const result = await this.context.pool.query<
      ConnectionRow & { account_fingerprint: string | null }
    >(
      `SELECT id, provider_key, label, auth_method, state, action_required,
              revision::text, last_verified_at, created_at, updated_at,
              (SELECT observation.account_fingerprint
               FROM transfers.connection_observations AS observation
               WHERE observation.connection_id = connection.id
                 AND observation.observed_state = 'ready'
               ORDER BY observation.observed_at DESC, observation.observation_id DESC
               LIMIT 1) AS account_fingerprint
       FROM transfers.provider_connections AS connection
       WHERE owner_membership_id = $1::uuid
       ORDER BY provider_key, created_at, id`,
      [memberId],
    )
    return result.rows.map((row) => projectConnection(row, row.account_fingerprint))
  }

  async applyCommand(
    memberId: string,
    command: ProviderConnectionCommandRequestV2,
  ): Promise<TransferCommandResult<ProviderConnectionV2>> {
    const kind = `provider-connection-${command.kind}`
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const prior = await this.context.prior<ProviderConnectionV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        if (prior.status === 'replayed') {
          const current = await this.getWithClient(client, memberId, command.connectionId)
          if (current !== undefined) {
            await client.query('COMMIT')
            return { ...prior, value: current }
          }
        }
        await client.query('COMMIT')
        return prior
      }
      if (prior === 'pending') throw new Error('connection command cannot remain pending')
      let row: ConnectionRow | undefined
      let projectionAccountFingerprint: string | null | undefined
      if (command.kind === 'create') {
        if (!this.context.enabledConnectionAuthMethods.get(command.providerKey)
            ?.has(command.authMethod) ||
          !authMethods[command.providerKey].includes(command.authMethod)) {
          const result = await this.context.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint,
            code: 'target-unavailable', at,
          })
          await client.query('COMMIT')
          return result
        }
        row = (await client.query<ConnectionRow>(
          `INSERT INTO transfers.provider_connections (
             id, owner_membership_id, provider_key, label, auth_method, state,
             action_required, revision, last_verified_at, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,'action-required',
             'complete-authorization',1,NULL,$6::timestamptz,$6::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, provider_key, label, auth_method, state, action_required,
                     revision::text, last_verified_at, created_at, updated_at`,
          [command.connectionId, memberId, command.providerKey,
            command.label, command.authMethod, at],
        )).rows[0]
        if (row === undefined) {
          const result = await this.context.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint,
            code: 'not-found', at,
          })
          await client.query('COMMIT')
          return result
        }
      } else {
        const current = (await client.query<
          ConnectionRow & { account_fingerprint: string | null }
        >(
          `SELECT id, provider_key, label, auth_method, state, action_required,
                  revision::text, last_verified_at, created_at, updated_at,
                  (SELECT observation.account_fingerprint
                   FROM transfers.connection_observations AS observation
                   WHERE observation.connection_id = connection.id
                     AND observation.observed_state = 'ready'
                   ORDER BY observation.observed_at DESC, observation.observation_id DESC
                   LIMIT 1) AS account_fingerprint
           FROM transfers.provider_connections AS connection
           WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR NO KEY UPDATE`,
          [command.connectionId, memberId],
        )).rows[0]
        if (current === undefined) {
          const result = await this.context.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint,
            code: 'not-found', at,
          })
          await client.query('COMMIT')
          return result
        }
        if (readOpaqueRevision('provider-connection', command.expectedConnectionRevision,
          command.connectionId) !== current.revision) {
          const result = await this.context.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint,
            code: 'revision-conflict', at,
          })
          await client.query('COMMIT')
          return result
        }
        projectionAccountFingerprint = current.account_fingerprint
        if (command.kind === 'rename') {
          row = (await client.query<ConnectionRow>(
            `UPDATE transfers.provider_connections
             SET label = $3, revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
             WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             RETURNING id, provider_key, label, auth_method, state, action_required,
                       revision::text, last_verified_at, created_at, updated_at`,
            [command.connectionId, memberId, command.label, at],
          )).rows[0]
        } else {
          const state = command.kind === 'revoke' ? 'revoked' : 'action-required'
          const action = command.kind === 'revoke' ? null : 'reauthorize'
          row = (await client.query<ConnectionRow>(
            `UPDATE transfers.provider_connections
             SET state = $3, action_required = $4, revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
             WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             RETURNING id, provider_key, label, auth_method, state, action_required,
                       revision::text, last_verified_at, created_at, updated_at`,
            [command.connectionId, memberId, state, action, at],
          )).rows[0]
          await this.revokeCaptureGrants(client, command.connectionId)
        }
      }
      const value = projectConnection(row!, projectionAccountFingerprint)
      const result = await this.context.recordAccepted(client, {
        commandId: command.commandId, memberId, kind, fingerprint, value, at,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async recordObservation(
    input: ProviderConnectionObservation,
  ): Promise<TransferCommandResult<ProviderConnectionV2>> {
    const kind = 'provider-connection-observation'
    const fingerprint = this.context.fingerprint(input)
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, input.observationId)
      const prior = await this.context.prior<ProviderConnectionV2>(client, {
        commandId: input.observationId,
        memberId: input.ownerMemberId,
        kind,
        fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        if (prior.status === 'replayed') {
          const current = await this.getWithClient(
            client, input.ownerMemberId, input.connectionId,
          )
          if (current !== undefined) {
            await client.query('COMMIT')
            return { ...prior, value: current }
          }
        }
        await client.query('COMMIT')
        return prior
      }
      const current = (await client.query<ConnectionRow>(
        `SELECT id, provider_key, label, auth_method, state, action_required,
                revision::text, last_verified_at, created_at, updated_at
         FROM transfers.provider_connections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR NO KEY UPDATE`,
        [input.connectionId, input.ownerMemberId],
      )).rows[0]
      if (current === undefined || current.state === 'revoked') {
        const result = await this.context.recordRejected<ProviderConnectionV2>(client, {
          commandId: input.observationId, memberId: input.ownerMemberId, kind, fingerprint,
          code: 'not-found', at: input.observedAt,
        })
        await client.query('COMMIT')
        return result
      }
      if (readOpaqueRevision('provider-connection', input.expectedConnectionRevision,
        input.connectionId) !== current.revision) {
        const result = await this.context.recordRejected<ProviderConnectionV2>(client, {
          commandId: input.observationId, memberId: input.ownerMemberId, kind, fingerprint,
          code: 'revision-conflict', at: input.observedAt,
        })
        await client.query('COMMIT')
        return result
      }
      await client.query(
        `INSERT INTO transfers.connection_observations (
           observation_id, connection_id, expected_connection_revision, observed_state,
           action_required, observed_at, observation_fingerprint, account_fingerprint
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz,$7,$8)`,
        [input.observationId, input.connectionId, current.revision, input.observedState,
          input.observedState === 'action-required' ? 'reauthorize' : null,
          input.observedAt, fingerprint, input.accountFingerprint],
      )
      const row = (await client.query<ConnectionRow>(
        `UPDATE transfers.provider_connections
         SET state = $3, action_required = $4,
             last_verified_at = CASE WHEN $3 = 'ready' THEN $5::timestamptz ELSE last_verified_at END,
             revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid
         RETURNING id, provider_key, label, auth_method, state, action_required,
                   revision::text, last_verified_at, created_at, updated_at`,
        [input.connectionId, input.ownerMemberId, input.observedState,
          input.observedState === 'action-required' ? 'reauthorize' : null, input.observedAt],
      )).rows[0]!
      await this.revokeCaptureGrants(
        client, input.connectionId,
        input.observedState === 'ready' ? input.accountFingerprint : undefined,
      )
      const value = projectConnection(
        row,
        input.observedState === 'ready' ? input.accountFingerprint : undefined,
      )
      const result = await this.context.recordAccepted(client, {
        commandId: input.observationId,
        memberId: input.ownerMemberId,
        kind,
        fingerprint,
        value,
        at: input.observedAt,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private async revokeCaptureGrants(
    client: import('pg').PoolClient,
    connectionId: string,
    retainedAccountFingerprint?: string,
  ): Promise<void> {
    // The connection's NO KEY UPDATE lock serializes lifecycle/issuance but allows an
    // in-flight capture's FK KEY SHARE. It may finish before revocation commits, never after.
    await client.query(
      `UPDATE transfers.connector_import_grants SET status = 'revoked'
       WHERE connection_id = $1::uuid AND status = 'active'
         AND ($2::text IS NULL OR account_fingerprint <> $2)`,
      [connectionId, retainedAccountFingerprint ?? null],
    )
  }

  private async getWithClient(
    client: { query: import('pg').PoolClient['query'] },
    memberId: string,
    connectionId: string,
  ): Promise<ProviderConnectionV2 | undefined> {
    const row = (await client.query<ConnectionRow & { account_fingerprint: string | null }>(
      `SELECT connection.id, connection.provider_key, connection.label,
              connection.auth_method, connection.state, connection.action_required,
              connection.revision::text, connection.last_verified_at,
              connection.created_at, connection.updated_at,
              (SELECT observation.account_fingerprint
               FROM transfers.connection_observations AS observation
               WHERE observation.connection_id = connection.id
                 AND observation.observed_state = 'ready'
               ORDER BY observation.observed_at DESC, observation.observation_id DESC
               LIMIT 1) AS account_fingerprint
       FROM transfers.provider_connections AS connection
       WHERE connection.id = $1::uuid AND connection.owner_membership_id = $2::uuid`,
      [connectionId, memberId],
    )).rows[0]
    return row === undefined ? undefined : projectConnection(row, row.account_fingerprint)
  }
}

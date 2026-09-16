import { sha256 } from '../../../application/connector-capture.js'
import {
  readOpaqueRevision,
  transferFingerprint,
} from '../../../application/identity.js'
import type { TransferCommandResult } from '../../../domain/model.js'
import type {
  ConnectorImportGrant,
  ConnectorImportGrantRequest,
} from '../../../domain/operations.js'
import {
  ConnectorCaptureContext,
  grantSelect,
  manifestFrom,
  type GrantRow,
  type ManifestRow,
} from './capture-context.js'

export class ConnectorImportGrantIssuer {
  constructor(private readonly context: ConnectorCaptureContext) {}

  async issue(
    memberId: string,
    request: ConnectorImportGrantRequest,
  ): Promise<TransferCommandResult<ConnectorImportGrant>> {
    const fingerprint = transferFingerprint({ memberId, request })
    const token = this.context.nextToken()
    const tokenDigest = sha256(token)
    const at = this.context.now()
    const expiresAt = new Date(at.getTime() + this.context.options.grantTtlMilliseconds)
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.connector-manifest:' || $1,0))",
        [request.manifest.manifestId],
      )
      const connection = (await client.query<{
        provider_key: 'naver' | 'google' | 'kakao'
        revision: string
        state: string
        account_fingerprint: string | null
        label: string
      }>(
        `SELECT connection.provider_key, connection.revision::text, connection.state,
                connection.label,
                (SELECT observation.account_fingerprint
                 FROM transfers.connection_observations AS observation
                 WHERE observation.connection_id = connection.id
                   AND observation.observed_state = 'ready'
                 ORDER BY observation.expected_connection_revision DESC,
                          observation.observation_id DESC LIMIT 1) AS account_fingerprint
         FROM transfers.provider_connections AS connection
         WHERE connection.id = $1::uuid AND connection.owner_membership_id = $2::uuid FOR NO KEY UPDATE`,
        [request.connectionId, memberId],
      )).rows[0]
      if (connection === undefined) {
        return await this.context.reject(client, request, 'not-found')
      }
      if (connection.state !== 'ready' || connection.account_fingerprint === null) {
        return await this.context.reject(client, request, 'connection-not-ready')
      }
      if (connection.provider_key !== request.providerKey ||
        connection.account_fingerprint !== request.accountFingerprint ||
        readOpaqueRevision('provider-connection', request.expectedConnectionRevision,
          request.connectionId) !== connection.revision) {
        return await this.context.reject(client, request, 'revision-conflict')
      }

      const priorCommand = (await client.query<GrantRow>(
        `${grantSelect} WHERE issued_grant.command_id = $1::uuid FOR UPDATE`,
        [request.commandId],
      )).rows[0]
      if (priorCommand !== undefined) {
        if (priorCommand.owner_membership_id !== memberId ||
          priorCommand.request_fingerprint !== fingerprint ||
          priorCommand.manifest_id !== request.manifest.manifestId) {
          await client.query('COMMIT')
          return {
            status: 'rejected',
            commandId: request.commandId,
            rejection: { code: 'command-id-reused' },
          }
        }
        const latestGeneration = Number((await client.query<{ maximum: number }>(
          `SELECT max(generation)::int AS maximum FROM transfers.connector_import_grants
           WHERE operation_id = $1::uuid`, [request.operationId],
        )).rows[0]!.maximum)
        if (priorCommand.generation !== latestGeneration || priorCommand.status !== 'receiving') {
          await client.query('COMMIT')
          return {
            status: 'rejected',
            commandId: request.commandId,
            rejection: { code: 'not-approvable' },
          }
        }
        await client.query('COMMIT')
        return {
          status: 'rejected',
          commandId: request.commandId,
          rejection: { code: 'not-approvable' },
        }
      }

      const priorManifest = (await client.query<ManifestRow>(
        `SELECT manifest_id, operation_id, owner_membership_id, connection_id, provider_key,
                account_fingerprint, installation_id, manifest_digest, source_revision,
                acquisition_kind, parser_version,
                observed_at, captured_at, expected_chunk_count, expected_list_count,
                expected_item_count, expected_byte_count, maximum_chunk_bytes, status, snapshot_id
         FROM transfers.connector_capture_manifests WHERE manifest_id = $1::uuid FOR UPDATE`,
        [request.manifest.manifestId],
      )).rows[0]
      if (priorManifest !== undefined && (
        priorManifest.owner_membership_id !== memberId ||
        priorManifest.operation_id !== request.operationId ||
        priorManifest.connection_id !== request.connectionId ||
        priorManifest.provider_key !== request.providerKey ||
        priorManifest.account_fingerprint !== request.accountFingerprint ||
        priorManifest.installation_id !== request.installationId ||
        !this.context.sameManifest(manifestFrom(priorManifest), request.manifest)
      )) return await this.context.reject(client, request, 'command-id-reused')
      if (priorManifest !== undefined) {
        const operation = (await client.query<{ state: string; cancel_requested: boolean }>(
          `SELECT state, cancel_requested FROM transfers.operations WHERE id = $1::uuid FOR UPDATE`,
          [request.operationId],
        )).rows[0]
        if (operation === undefined || operation.cancel_requested ||
          !['queued', 'running'].includes(operation.state) ||
          ['completed', 'cancelled'].includes(priorManifest.status)) {
          return await this.context.reject(client, request, 'not-approvable')
        }
        if (priorManifest.status === 'expired') {
          await client.query(
            `UPDATE transfers.connector_capture_manifests SET status = 'receiving'
             WHERE manifest_id = $1::uuid AND status = 'expired'`,
            [request.manifest.manifestId],
          )
        }
      }

      if (priorManifest === undefined) {
        await client.query(
          `INSERT INTO transfers.operations (
             id, owner_membership_id, kind, provider_key, connection_id, account_label,
             import_source_id, import_source_kind,
             resource_kind, resource_id, stage, state, total_count, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,'import-capture',$3,$4::uuid,$5,
             $4::uuid,'verified-connection','snapshot',$6::uuid,
             'awaiting-connector','queued',$7,$8::timestamptz,$8::timestamptz)`,
          [request.operationId, memberId, request.providerKey, request.connectionId,
            connection.label, request.manifest.manifestId, request.manifest.itemCount,
            at.toISOString()],
        )
        await client.query(
          `INSERT INTO transfers.connector_capture_manifests (
             manifest_id, operation_id, owner_membership_id, connection_id, provider_key,
             account_fingerprint, installation_id, manifest_digest, source_revision,
             acquisition_kind, parser_version, observed_at, captured_at,
             expected_chunk_count, expected_list_count,
             expected_item_count, expected_byte_count, maximum_chunk_bytes, status
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8,$9,$10,$11,
             $12::timestamptz,$13::timestamptz,$14,$15,$16,$17,$18,'receiving')`,
          [request.manifest.manifestId, request.operationId, memberId, request.connectionId,
            request.providerKey, request.accountFingerprint, request.installationId,
            request.manifest.manifestDigest, request.manifest.sourceRevision,
            request.manifest.provenance?.acquisitionKind ?? null,
            request.manifest.provenance?.parserVersion ?? null,
            request.manifest.observedAt, request.manifest.capturedAt,
            request.manifest.chunkCount, request.manifest.listCount,
            request.manifest.itemCount, request.manifest.byteCount,
            this.context.options.maximumChunkBytes],
        )
      }
      const generation = Number((await client.query<{ next: number }>(
        `SELECT coalesce(max(generation),0)::int + 1 AS next
         FROM transfers.connector_import_grants WHERE operation_id = $1::uuid`,
        [request.operationId],
      )).rows[0]!.next)
      await client.query(
        `UPDATE transfers.connector_import_grants SET status = 'revoked'
         WHERE operation_id = $1::uuid AND status = 'active'`, [request.operationId],
      )
      const grantId = this.context.nextId()
      await client.query(
        `INSERT INTO transfers.connector_import_grants (
           grant_id, command_id, operation_id, manifest_id, generation, owner_membership_id,
           connection_id, provider_key, account_fingerprint, installation_id,
           request_fingerprint, token_digest, place_origin, status, issued_at, expires_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8,$9,$10::uuid,
           $11,$12,$13,'active',$14::timestamptz,$15::timestamptz)`,
        [grantId, request.commandId, request.operationId, request.manifest.manifestId, generation,
          memberId, request.connectionId, request.providerKey, request.accountFingerprint,
          request.installationId, fingerprint, tokenDigest, request.placeOrigin,
          at.toISOString(), expiresAt.toISOString()],
      )
      await client.query('COMMIT')
      const row: GrantRow = {
        grant_id: grantId,
        command_id: request.commandId,
        operation_id: request.operationId,
        generation,
        request_fingerprint: fingerprint,
        token_digest: tokenDigest,
        place_origin: request.placeOrigin,
        grant_status: 'active',
        issued_at: at,
        expires_at: expiresAt,
        manifest_id: request.manifest.manifestId,
        owner_membership_id: memberId,
        connection_id: request.connectionId,
        provider_key: request.providerKey,
        account_fingerprint: request.accountFingerprint,
        installation_id: request.installationId,
        manifest_digest: request.manifest.manifestDigest,
        source_revision: request.manifest.sourceRevision,
        acquisition_kind: request.manifest.provenance?.acquisitionKind ?? null,
        parser_version: request.manifest.provenance?.parserVersion ?? null,
        observed_at: new Date(request.manifest.observedAt),
        captured_at: new Date(request.manifest.capturedAt),
        expected_chunk_count: request.manifest.chunkCount,
        expected_list_count: request.manifest.listCount,
        expected_item_count: request.manifest.itemCount,
        expected_byte_count: request.manifest.byteCount,
        maximum_chunk_bytes: this.context.options.maximumChunkBytes,
        status: 'receiving',
        snapshot_id: null,
      }
      return {
        status: 'applied',
        commandId: request.commandId,
        value: this.context.projectGrant(row, token, at, expiresAt),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }
}

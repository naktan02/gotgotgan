import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { startPreparedPlaceDatabase } from '../support/prepared-place-database.mjs'

export const transferOperationIds = Object.freeze({
  memberId: '01993000-0000-7000-8000-000000000001',
  otherMemberId: '01993000-0000-7000-8000-000000000002',
  connectionId: '01993000-0000-7000-8000-000000000003',
  collectionId: '01993000-0000-7000-8000-000000000004',
  placeId: '01993000-0000-7000-8000-000000000005',
})

export const transferOperationEvidence = Object.freeze({
  accountFingerprint: 'a'.repeat(64),
  placeOrigin: 'https://app.gotgotgan.test',
  at: '2026-09-03T02:00:00.000Z',
})

export function transferOperationId(value) {
  return `01993000-0000-7000-8000-${String(value).padStart(12, '0')}`
}

export function transferOperationDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function connectorCapturePayload(start, count) {
  return JSON.stringify({
    lists: [{
      sourceListId: 'bulk-list',
      observedName: '대량 목록',
      sourcePosition: 0,
      items: Array.from({ length: count }, (_, offset) => ({
        sourceItemId: `bulk-item-${start + offset}`,
        providerPlaceId: null,
        observedName: `장소 ${start + offset}`,
        observedAddress: null,
        observedCategory: null,
        observedLocation: null,
        sourcePosition: start + offset,
      })),
    }],
  })
}

export function emptyConnectorCapturePayload() {
  return JSON.stringify({ lists: [] })
}

export function connectorCaptureChunk(sequence, payload, itemCount) {
  return {
    sequence,
    itemCount,
    byteCount: Buffer.byteLength(payload, 'utf8'),
    checksum: transferOperationDigest(payload),
  }
}

export function connectorCaptureManifest({
  captureManifestDigestInput,
  operationId,
  manifestId,
  installationId,
  sourceRevision,
  chunks,
  listCount,
  itemCount,
  digest,
  provenance,
}) {
  const manifestWithoutDigest = {
    manifestId,
    sourceRevision,
    ...(provenance === undefined ? {} : { provenance }),
    observedAt: '2026-09-03T02:00:01.000Z',
    capturedAt: '2026-09-03T02:00:02.000Z',
    chunkCount: chunks.length,
    listCount,
    itemCount,
    byteCount: chunks.reduce((sum, chunk) => sum + chunk.byteCount, 0),
  }
  return {
    ...manifestWithoutDigest,
    manifestDigest: digest ?? transferOperationDigest(captureManifestDigestInput({
      operationId,
      connectionId: transferOperationIds.connectionId,
      providerKey: 'naver',
      accountFingerprint: transferOperationEvidence.accountFingerprint,
      installationId,
      manifest: manifestWithoutDigest,
      chunks: chunks.map(({ sequence, itemCount: count, byteCount, checksum }) => ({
        sequence,
        itemCount: count,
        byteCount,
        checksum,
      })),
    })),
  }
}

export async function startTransferOperationsPostgresDatabase(prefix) {
  const database = await startPreparedPlaceDatabase(prefix)
  try {
    const [library, transfersModule, connectorCapture] = await Promise.all([
      import('../../../dist/modules/library/index.js'),
      import('../../../dist/modules/transfers/index.js'),
      import('../../../dist/modules/transfers/application/connector-capture.js'),
    ])
    return {
      database,
      library,
      transfersModule,
      connectorCapture,
      close: () => database.close(),
    }
  } catch (error) {
    await database.close()
    throw error
  }
}

export async function startReadyTransferOperationsFixture(prefix) {
  const fixture = await startTransferOperationsPostgresDatabase(prefix)
  const {
    memberId, otherMemberId, connectionId, collectionId, placeId,
  } = transferOperationIds
  const { accountFingerprint, at } = transferOperationEvidence

  try {
    await fixture.database.pool.query(
      `INSERT INTO access.memberships (
         id, issuer, subject, status, authority_role, product_tier, user_grade,
         created_at, updated_at
       ) VALUES
         ($1::uuid,'https://identity.example.test','stage10-owner','active','member','standard',
          'unclassified',$3::timestamptz,$3::timestamptz),
         ($2::uuid,'https://identity.example.test','stage10-other','active','member','standard',
          'unclassified',$3::timestamptz,$3::timestamptz)`,
      [memberId, otherMemberId, at],
    )
    await fixture.database.pool.query(
      'INSERT INTO places.canonical_places (id) VALUES ($1::uuid)',
      [placeId],
    )
    await fixture.database.pool.query(
      `INSERT INTO library.collections (
         id, owner_membership_id, name, description, visibility, publication_id,
         created_at, updated_at
       ) VALUES ($1::uuid,$2::uuid,'내보낼 목록',NULL,'private',NULL,
         $3::timestamptz,$3::timestamptz)`,
      [collectionId, memberId, at],
    )
    await fixture.database.pool.query(
      `INSERT INTO library.collection_places (
         collection_id, canonical_place_id, position, added_at
       ) VALUES ($1::uuid,$2::uuid,0,$3::timestamptz)`,
      [collectionId, placeId, at],
    )

    const collectionReader = new fixture.library.PostgresCollectionTransferReader(
      fixture.database.pool,
    )
    const materializer = new fixture.library.PostgresImportedCollectionMaterializer(
      fixture.database.pool,
    )
    const target = {
      providerKey: 'naver',
      async observe() {
        return { revision: 'target-observation-1', lists: [] }
      },
      async preflight(input) {
        return {
          observationRevision: 'target-observation-1',
          items: input.items.map((item) => ({
            placeId: item.placeId,
            status: 'add',
            targetProviderPlaceId: `naver-${item.placeId}`,
          })),
        }
      },
    }
    const transfers = new fixture.transfersModule.PostgresProviderTransfers({
      pool: fixture.database.pool,
      materializer,
      collections: collectionReader,
      targets: [target],
      enabledConnectionAuthMethods: { naver: ['browser-session'] },
      now: () => new Date(at),
    })
    const createdConnection = await transfers.applyConnectionCommand(memberId, {
      schemaVersion: 'provider-connection-command.v2',
      kind: 'create',
      commandId: transferOperationId(100),
      connectionId,
      providerKey: 'naver',
      label: '검증된 네이버 계정',
      authMethod: 'browser-session',
    })
    assert.equal(createdConnection.status, 'applied')
    const verifiedConnection = await transfers.recordConnectionObservation({
      observationId: transferOperationId(101),
      ownerMemberId: memberId,
      connectionId,
      expectedConnectionRevision: createdConnection.value.connectionRevision,
      accountFingerprint,
      observedState: 'ready',
      observedAt: '2026-09-03T02:00:01.000Z',
    })
    assert.equal(verifiedConnection.status, 'applied')
    assert.deepEqual((await fixture.database.pool.query(
      `SELECT connection.state,
              observation.account_fingerprint AS observed_account_fingerprint
       FROM transfers.provider_connections AS connection
       JOIN transfers.connection_observations AS observation
         ON observation.connection_id = connection.id
       WHERE connection.id = $1::uuid`,
      [connectionId],
    )).rows, [{
      state: 'ready',
      observed_account_fingerprint: accountFingerprint,
    }])
    const sourceCollection = await collectionReader.read({ memberId, collectionId })
    return {
      ...fixture,
      collectionReader,
      materializer,
      transfers,
      createdConnection,
      verifiedConnection,
      sourceCollection,
    }
  } catch (error) {
    await fixture.close()
    throw error
  }
}

export function createOutboundExecutionTestDriver(fixture, firstId = 700) {
  const { memberId, connectionId, collectionId } = transferOperationIds
  const { accountFingerprint, placeOrigin } = transferOperationEvidence
  let fixtureId = firstId
  const nextId = () => transferOperationId(fixtureId++)
  const operations = new fixture.transfersModule.PostgresTransferOperations(
    fixture.database.pool,
    () => new Date('2026-09-03T02:00:04.000Z'),
  )
  let outboundToken = 0
  const outbound = new fixture.transfersModule.PostgresOutboundExecutions(
    fixture.database.pool,
    operations,
    {
      grantTtlMilliseconds: 300_000,
      receiptTtlMilliseconds: 300_000,
      maximumBytes: 1_048_576,
      maximumBatches: 10,
      nextId,
      nextToken: () => `outbound-token-${++outboundToken}`,
      now: () => new Date('2026-09-03T02:00:05.000Z'),
    },
  )

  async function openExecution(target) {
    const transferId = nextId()
    const preview = await fixture.transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2',
      kind: 'preview',
      commandId: nextId(),
      transferId,
      connectionId,
      collectionId,
      expectedCollectionRevision: fixture.sourceCollection.collectionVersion,
      selection: { kind: 'all' },
      target,
    })
    assert.equal(preview.status, 'applied', JSON.stringify(preview))
    const approved = await fixture.transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2',
      kind: 'approve',
      commandId: nextId(),
      transferId,
      expectedTransferRevision: preview.value.transferRevision,
    })
    assert.equal(approved.status, 'applied', JSON.stringify(approved))
    const installationId = nextId()
    const grant = await outbound.issueGrant(memberId, {
      commandId: nextId(),
      transferId,
      expectedTransferRevision: approved.value.transferRevision,
      installationId,
      accountFingerprint,
      placeOrigin,
    })
    assert.equal(grant.status, 'applied', JSON.stringify(grant))
    const receipt = await outbound.consume({
      token: grant.value.token,
      request: {
        grantId: grant.value.grantId,
        operationId: grant.value.operationId,
        connectionId,
        providerKey: 'naver',
        accountFingerprint,
        installationId,
        planDigest: grant.value.planDigest,
        sourceOrigin: placeOrigin,
        itemCount: 1,
        byteCount: 128,
        batchCount: 1,
        batchSize: 1,
      },
    })
    return { transferId, grant: grant.value, receipt }
  }

  async function prepareAttempt(execution, attempt) {
    return outbound.prepareAttempt({
      receiptToken: execution.receipt.receiptToken,
      sourceOrigin: placeOrigin,
      intent: {
        operationId: attempt.operationId,
        receiptReference: attempt.receiptReference,
        attemptId: attempt.attemptId,
        phase: attempt.phase,
        targetListId: attempt.phase === 'create-target-list' ? null : attempt.targetListId,
        sequence: attempt.sequence,
        final: attempt.final,
        reconciliationReference: attempt.reconciliationReference ?? `prepared-${attempt.attemptId}`,
        items: attempt.items.map((item) => ({
          itemKey: item.itemKey,
          targetReference: item.targetReference,
        })),
      },
    })
  }

  async function recordPreparedAttempt(execution, attempt) {
    await prepareAttempt(execution, attempt)
    return outbound.recordAttempt({
      receiptToken: execution.receipt.receiptToken,
      sourceOrigin: placeOrigin,
      attempt,
    })
  }

  return { operations, outbound, nextId, openExecution, prepareAttempt, recordPreparedAttempt }
}

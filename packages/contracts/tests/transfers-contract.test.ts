import { describe, expect, it } from 'vitest'

import {
  connectorCaptureManifestDigestInputV2,
  connectorCaptureManifestV2Schema,
  connectorImportGrantResultV2Schema,
  importPlanCommandRequestV2Schema,
  importPlanCommandRequestV3Schema,
  importPlanCommandResultV3Schema,
  importPlanV2Schema,
  importPlanV3Schema,
  outboundExecutionReconciliationV2Schema,
  outboundExecutionGrantResultV2Schema,
  outboundPlaceSelectionV2Schema,
  providerCapabilityListV2Schema,
  providerConnectionV2Schema,
  sourceSnapshotDetailV2Schema,
} from '../src/transfers/index.js'
import { buildOpenApiDocument } from '../src/http/openapi.js'

const id = '01992d42-0000-7000-8000-000000000001'

describe('provider transfer contracts', () => {
  it('binds optional acquisition provenance into new Connector snapshot commitments', () => {
    const legacyManifest = {
      manifestId: id,
      manifestDigest: 'a'.repeat(64),
      sourceRevision: 'source-r1',
      observedAt: '2026-09-03T00:00:00.000Z',
      capturedAt: '2026-09-03T00:00:00.000Z',
      chunkCount: 1,
      listCount: 1,
      itemCount: 1,
      byteCount: 2,
    }
    expect(connectorCaptureManifestV2Schema.safeParse(legacyManifest).success).toBe(true)
    const current = {
      ...legacyManifest,
      provenance: {
        acquisitionKind: 'browser-network' as const,
        parserVersion: 'naver-saved-place-normalizer.v1',
      },
    }
    expect(connectorCaptureManifestV2Schema.safeParse(current).success).toBe(true)
    const input = {
      operationId: id,
      connectionId: id,
      providerKey: 'naver',
      accountFingerprint: 'b'.repeat(64),
      installationId: id,
      chunks: [{ sequence: 0, itemCount: 1, byteCount: 2, checksum: 'c'.repeat(64) }],
    }
    expect(connectorCaptureManifestDigestInputV2({
      ...input,
      manifest: legacyManifest,
    })).not.toBe(connectorCaptureManifestDigestInputV2({
      ...input,
      manifest: current,
    }))
  })

  it('keeps policy creation out of v2 and exposes it with strict identity shape in v3', () => {
    const policyItem = {
      sourceItemId: 'item-1', providerPlaceId: 'naver-place-1', observedName: '라멘집',
      observedAddress: null, placeId: null, status: 'add', decision: 'policy-create',
      providerDetailStatus: 'available',
    }
    const plan = {
      schemaVersion: 'import-plan.v3', planId: id, planRevision: 'revision', snapshotId: id,
      snapshotVersion: 'snapshot-revision', providerKey: 'naver', connectionId: id,
      state: 'draft', approval: { eligible: true, reason: null },
      mappings: [{
        sourceListId: 'list-1', observedName: '서울 라멘', sourcePosition: 0,
        target: { kind: 'new', collectionId: id, name: '서울 라멘' },
        itemCount: 1, unresolvedItemCount: 0,
        preview: {
          addCount: 1, alreadyPresentCount: 0, unresolvedCount: 0, skippedCount: 0,
          items: [policyItem],
        },
        materialization: { state: 'pending', collectionRevision: null, rejectionCode: null },
      }],
      createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
    }
    expect(importPlanV3Schema.safeParse(plan).success).toBe(true)
    expect(importPlanV2Schema.safeParse({ ...plan, schemaVersion: 'import-plan.v2' }).success)
      .toBe(false)
    for (const providerDetailStatus of ['pending', 'available', 'unavailable'] as const) {
      expect(importPlanV3Schema.safeParse({
        ...plan,
        approval: { eligible: false, reason: 'unresolved-places' },
        mappings: [{ ...plan.mappings[0], unresolvedItemCount: 1, preview: {
          addCount: 0, alreadyPresentCount: 0, unresolvedCount: 1, skippedCount: 0,
          items: [{ ...policyItem, status: 'unresolved', decision: 'none',
            providerDetailStatus }],
        } }],
      }).success).toBe(true)
    }
    for (const invalidItem of [
      { ...policyItem, providerPlaceId: null },
      { ...policyItem, placeId: id },
      { ...policyItem, status: 'already-present' },
      { ...policyItem, decision: 'none' },
      { ...policyItem, providerDetailStatus: 'pending' },
    ]) {
      expect(importPlanV3Schema.safeParse({
        ...plan,
        mappings: [{ ...plan.mappings[0], preview: { ...plan.mappings[0].preview,
          items: [invalidItem] } }],
      }).success).toBe(false)
    }
  })

  it('publishes isolated v3 import command, result, Backend, and browser contracts', () => {
    const command = {
      schemaVersion: 'import-plan-command.v3', kind: 'approve', commandId: id,
      planId: id, expectedPlanRevision: 'revision',
    }
    expect(importPlanCommandRequestV3Schema.safeParse(command).success).toBe(true)
    expect(importPlanCommandRequestV2Schema.safeParse({
      ...command, schemaVersion: 'import-plan-command.v2',
    }).success).toBe(true)
    expect(importPlanCommandRequestV2Schema.safeParse(command).success).toBe(false)

    const resultPlan = {
      schemaVersion: 'import-plan.v3', planId: id, planRevision: 'revision', snapshotId: id,
      snapshotVersion: 'snapshot-revision', providerKey: 'naver', connectionId: id,
      state: 'draft', approval: { eligible: false, reason: 'unresolved-places' },
      mappings: [{
        sourceListId: 'list-1', observedName: '목록', sourcePosition: 0,
        target: { kind: 'new', collectionId: id, name: '목록' },
        itemCount: 1, unresolvedItemCount: 1,
        preview: {
          addCount: 0, alreadyPresentCount: 0, unresolvedCount: 1, skippedCount: 0,
          items: [{
            sourceItemId: 'item-1', providerPlaceId: null, observedName: '장소',
            observedAddress: null, placeId: null, status: 'unresolved', decision: 'none',
            providerDetailStatus: null,
          }],
        },
        materialization: { state: 'pending', collectionRevision: null, rejectionCode: null },
      }],
      createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
    }
    expect(importPlanCommandResultV3Schema.safeParse({
      schemaVersion: 'import-plan-command-result.v3', outcome: 'accepted', commandId: id,
      status: 'applied', plan: resultPlan,
    }).success).toBe(true)

    expect(importPlanCommandRequestV3Schema.safeParse({
      schemaVersion: 'import-plan-command.v3', kind: 'refresh-evidence', commandId: id,
      planId: id, expectedPlanRevision: 'revision',
    }).success).toBe(true)

    const openApi = buildOpenApiDocument() as Readonly<{
      paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    }>
    const backendCommand = openApi.paths['/v3/transfers/import-plan-commands']?.post as
      Readonly<{ operationId?: string }> | undefined
    const browserCommand = openApi.paths['/api/v3/transfers/import-plan-commands']?.post as
      Readonly<{ operationId?: string }> | undefined
    const backendPlan = openApi.paths['/v3/transfers/import-plans/{planId}']?.get as
      Readonly<{ operationId?: string }> | undefined
    expect(backendCommand?.operationId).toBe('applyImportPlanCommandV3')
    expect(browserCommand?.operationId).toBe('applyImportPlanCommandV3ForBrowser')
    expect(backendPlan?.operationId).toBe('getImportPlanV3')
  })

  it('allows an unavailable provider to advertise no auth methods', () => {
    expect(providerCapabilityListV2Schema.safeParse({
      schemaVersion: 'provider-capability-list.v2',
      items: ['naver', 'google', 'kakao'].map((providerKey) => ({
        providerKey,
        displayName: providerKey,
        connections: { availability: 'unavailable', multipleAccounts: true, authMethods: [] },
        importSavedPlaces: { availability: 'unavailable', reason: 'source-adapter-unavailable' },
        exportCollections: { availability: 'unavailable', reason: 'target-adapter-unavailable' },
      })),
    }).success).toBe(true)
  })

  it('requires one capability per provider and coherent availability details', () => {
    const capability = (providerKey: 'naver' | 'google' | 'kakao') => ({
      providerKey, displayName: providerKey,
      connections: { availability: 'unavailable', multipleAccounts: true, authMethods: [] },
      importSavedPlaces: { availability: 'unavailable', reason: 'source-adapter-unavailable' },
      exportCollections: { availability: 'unavailable', reason: 'target-adapter-unavailable' },
    })
    expect(providerCapabilityListV2Schema.safeParse({
      schemaVersion: 'provider-capability-list.v2',
      items: [capability('naver'), capability('naver'), capability('kakao')],
    }).success).toBe(false)
    expect(providerCapabilityListV2Schema.safeParse({
      schemaVersion: 'provider-capability-list.v2',
      items: [
        { ...capability('naver'), connections: {
          availability: 'available', multipleAccounts: true,
          authMethods: ['manual-file', 'manual-file'],
        } },
        capability('google'), capability('kakao'),
      ],
    }).success).toBe(false)
    expect(providerCapabilityListV2Schema.safeParse({
      schemaVersion: 'provider-capability-list.v2',
      items: [
        { ...capability('naver'), importSavedPlaces: {
          availability: 'available', reason: 'source-adapter-unavailable',
        } },
        capability('google'), capability('kakao'),
      ],
    }).success).toBe(false)
  })

  it('never accepts connection credentials in a projection', () => {
    expect(providerConnectionV2Schema.safeParse({
      schemaVersion: 'provider-connection.v2', connectionId: id, providerKey: 'naver',
      label: '내 계정', authMethod: 'browser-session', state: 'action-required',
      connectionRevision: 'revision', lastVerifiedAt: null,
      actionRequired: 'complete-authorization',
      createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
      token: 'must-not-cross-the-contract',
    }).success).toBe(false)
  })

  it('rejects duplicate outbound Place selections', () => {
    expect(outboundPlaceSelectionV2Schema.safeParse({
      kind: 'places', placeIds: [id, id],
    }).success).toBe(false)
  })

  it('does not claim replayable plaintext connector grants', () => {
    const rejectedGrant = {
      schemaVersion: 'connector-import-grant-result.v2', outcome: 'accepted',
      commandId: id, status: 'replayed', grant: {},
    }
    expect(connectorImportGrantResultV2Schema.safeParse(rejectedGrant).success).toBe(false)
    expect(outboundExecutionGrantResultV2Schema.safeParse({
      ...rejectedGrant, schemaVersion: 'outbound-execution-grant-result.v2',
    }).success).toBe(false)
  })

  it('rejects partial target-list reconciliation while preserving partial item reconciliation', () => {
    const reconciliation = {
      schemaVersion: 'outbound-execution-reconciliation.v2',
      reconciliationId: id,
      operationId: id,
      receiptReference: id,
      attemptId: id,
      targetListId: 'provider-list',
      reconciliationReference: 'provider-observation',
      outcome: 'resolved-partial',
      items: [],
    }

    expect(outboundExecutionReconciliationV2Schema.safeParse({
      ...reconciliation,
      phase: 'create-target-list',
    }).success).toBe(false)
    expect(outboundExecutionReconciliationV2Schema.safeParse({
      ...reconciliation,
      phase: 'add-items',
    }).success).toBe(true)
  })

  it('bounds an immutable snapshot across all lists', () => {
    const item = {
      sourceItemId: 'item', providerPlaceId: null, observedName: '장소',
      observedAddress: null, observedCategory: null, observedLocation: null,
      match: { status: 'unresolved', reason: 'missing-identity' }, sourcePosition: 0,
    }
    const lists = Array.from({ length: 21 }, (_, listIndex) => ({
      sourceListId: `list-${listIndex}`, observedName: `목록 ${listIndex}`,
      sourcePosition: listIndex, itemCount: 500, unresolvedItemCount: 500,
      items: Array.from({ length: 500 }, (_, itemIndex) => ({
        ...item, sourceItemId: `item-${itemIndex}`, sourcePosition: itemIndex,
      })),
    }))
    expect(sourceSnapshotDetailV2Schema.safeParse({
      schemaVersion: 'source-snapshot-detail.v2', snapshotId: id,
      snapshotVersion: 'revision', connectionId: id, providerKey: 'naver',
      sourceRevision: 'source',
      listCount: lists.length, itemCount: 10_500,
      unresolvedItemCount: 10_500, observedAt: '2026-09-03T00:00:00.000Z',
      capturedAt: '2026-09-03T00:00:00.000Z', lists,
    }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { createDataTransferSettingsGateway } from './data-transfer-settings-client'

const collectionId = '01992d20-0000-7000-8000-000000000001'
const connectionId = '01992d20-0000-7000-8000-000000000002'
const placeId = '01992d20-0000-7000-8000-000000000003'
const commandId = '01992d20-0000-7000-8000-000000000004'

describe('data transfer settings client', () => {
  it('sends an explicit partial place selection and keeps adapter-unavailable preview blocked', async () => {
    let requestBody: unknown
    const gateway = createDataTransferSettingsGateway(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return Response.json({
        schemaVersion: 'outbound-transfer-command-result.v2', outcome: 'accepted',
        commandId, status: 'applied',
        transfer: {
          schemaVersion: 'outbound-transfer.v2', transferId: commandId,
          transferRevision: 'transfer-r1', providerKey: 'naver', connectionId,
          collectionId, collectionRevision: 'collection-r1',
          target: { kind: 'new-list', name: '도쿄 여행' },
          targetObservationRevision: null, planDigest: 'a'.repeat(64), state: 'blocked',
          selection: { kind: 'places', placeIds: [placeId] }, itemCount: 1,
          preview: { availability: 'unavailable', addCount: null, alreadyPresentCount: null, unresolvedCount: null, unsupportedCount: null, items: [] },
          approval: { eligible: false, reason: 'target-adapter-unavailable' },
          approvalReceipt: null, createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
        },
      })
    })
    const preview = await gateway.previewExport({
      commandId, providerKey: 'naver', connectionId, collectionId,
      expectedCollectionRevision: 'collection-r1',
      selection: { kind: 'places', placeIds: [placeId] },
      targetList: { kind: 'new', name: '도쿄 여행' },
    })
    expect(requestBody).toMatchObject({ selection: { kind: 'places', placeIds: [placeId] } })
    expect(preview.state).toBe('blocked')
    expect(preview.approvalEligible).toBe(false)
    expect(preview.blockedReason).toContain('어댑터')
  })

  it('uses backend import preview counts instead of fabricating match results', async () => {
    const gateway = createDataTransferSettingsGateway(async () => Response.json({
      schemaVersion: 'import-plan-command-result.v2', outcome: 'accepted',
      commandId, status: 'applied',
      plan: {
        schemaVersion: 'import-plan.v2', planId: commandId, planRevision: 'plan-r1',
        snapshotId: '01992d20-0000-7000-8000-000000000005', snapshotVersion: 'snapshot-r1',
        providerKey: 'naver', connectionId, state: 'draft',
        approval: { eligible: false, reason: 'unresolved-places' },
        mappings: [{
          sourceListId: 'source-list', observedName: '도쿄 여행', sourcePosition: 0,
          target: { kind: 'new', collectionId, name: '도쿄 여행' }, itemCount: 3, unresolvedItemCount: 1,
          preview: { addCount: 1, alreadyPresentCount: 1, unresolvedCount: 1, skippedCount: 0, items: [{
            sourceItemId: 'source-item', providerPlaceId: null, observedName: '센소지',
            observedAddress: '도쿄도 다이토구', placeId: null, status: 'unresolved', decision: 'none',
          }] },
          materialization: { state: 'pending', collectionRevision: null, rejectionCode: null },
        }],
        createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
      },
    }))
    const preview = await gateway.previewImport({
      commandId, snapshotId: '01992d20-0000-7000-8000-000000000005',
      expectedSnapshotRevision: 'snapshot-r1',
      mappings: [{ sourceListId: 'source-list', selected: true, target: { kind: 'new', collectionId, name: '도쿄 여행' } }],
    })
    expect(preview.summary).toEqual({ add: 1, alreadyPresent: 1, reviewRequired: 1, unsupported: 0 })
    expect(preview.matches[0]).toMatchObject({ sourceName: '센소지', sourceAddress: '도쿄도 다이토구', status: 'review-required' })
    expect(preview.approvalEligible).toBe(false)
  })

  it('preserves authentication failures as a distinct settings problem', async () => {
    const gateway = createDataTransferSettingsGateway(async () => Response.json({}, { status: 401 }))
    await expect(gateway.targetLists(connectionId)).rejects.toMatchObject({ status: 401 })
  })
})

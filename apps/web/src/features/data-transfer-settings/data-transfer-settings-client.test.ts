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
    let requestPath: string | undefined
    let requestBody: unknown
    const gateway = createDataTransferSettingsGateway(async (input, init) => {
      requestPath = String(input)
      requestBody = JSON.parse(String(init?.body))
      return Response.json({
        schemaVersion: 'import-plan-command-result.v3', outcome: 'accepted',
        commandId, status: 'applied',
        plan: {
          schemaVersion: 'import-plan.v3', planId: commandId, planRevision: 'plan-r1',
          snapshotId: '01992d20-0000-7000-8000-000000000005', snapshotVersion: 'snapshot-r1',
          providerKey: 'naver', connectionId, state: 'draft',
          approval: { eligible: false, reason: 'unresolved-places' },
          mappings: [{
            sourceListId: 'source-list', observedName: '도쿄 여행', sourcePosition: 0,
            target: { kind: 'new', collectionId, name: '도쿄 여행' }, itemCount: 3, unresolvedItemCount: 1,
            preview: { addCount: 1, alreadyPresentCount: 1, unresolvedCount: 1, skippedCount: 0, items: [
              {
                sourceItemId: 'source-auto', providerPlaceId: 'provider-place', observedName: '도쿄 타워',
                observedAddress: null, placeId: null, status: 'add', decision: 'policy-create',
                providerDetailStatus: 'pending',
              },
              {
                sourceItemId: 'source-item', providerPlaceId: null, observedName: '센소지',
                observedAddress: '도쿄도 다이토구', placeId: null, status: 'unresolved', decision: 'none',
                providerDetailStatus: null,
              },
            ] },
            materialization: { state: 'pending', collectionRevision: null, rejectionCode: null },
          }],
          createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
        },
      })
    })
    const preview = await gateway.previewImport({
      commandId, snapshotId: '01992d20-0000-7000-8000-000000000005',
      expectedSnapshotRevision: 'snapshot-r1',
      mappings: [{ sourceListId: 'source-list', selected: true, target: { kind: 'new', collectionId, name: '도쿄 여행' } }],
    })
    expect(requestPath).toBe('/api/v3/transfers/import-plan-commands')
    expect(requestBody).toMatchObject({ schemaVersion: 'import-plan-command.v3' })
    expect(preview.summary).toEqual({ add: 1, alreadyPresent: 1, reviewRequired: 1, unsupported: 0 })
    expect(preview.providerDetails).toEqual({ pending: 1, available: 0, unavailable: 0 })
    expect(preview.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: '도쿄 타워', status: 'add' }),
      expect.objectContaining({ sourceName: '센소지', sourceAddress: '도쿄도 다이토구', status: 'review-required' }),
    ]))
    expect(preview.approvalEligible).toBe(false)
  })

  it('approves minimum-data items without detail calls and counts beyond the display limit', async () => {
    const requests: Readonly<{ path: string; body?: Record<string, unknown> }>[] = []
    const pendingItems = Array.from({ length: 101 }, (_, index) => ({
      sourceItemId: `source-${index}`, providerPlaceId: `provider-${index}`,
      observedName: `장소 ${index}`, observedAddress: null, placeId: null,
      status: 'add', decision: 'policy-create',
      providerDetailStatus: index === 100 ? 'unavailable' : 'pending',
    }))
    const plan = {
      schemaVersion: 'import-plan.v3' as const, planId: commandId, planRevision: 'plan-r1',
      snapshotId: '01992d20-0000-7000-8000-000000000005', snapshotVersion: 'snapshot-r1',
      providerKey: 'naver' as const, connectionId, state: 'draft' as const,
      approval: { eligible: true, reason: null },
      mappings: [{
        sourceListId: 'source-list', observedName: '도쿄 여행', sourcePosition: 0,
        target: { kind: 'new' as const, collectionId, name: '도쿄 여행' },
        itemCount: 101, unresolvedItemCount: 0,
        preview: { addCount: 101, alreadyPresentCount: 0, unresolvedCount: 0,
          skippedCount: 0, items: pendingItems },
        materialization: { state: 'pending' as const, collectionRevision: null, rejectionCode: null },
      }],
      createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
    }
    const gateway = createDataTransferSettingsGateway(async (input, init) => {
      requests.push({ path: String(input), ...(init?.body === undefined ? {} : {
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      }) })
      return init?.method === 'POST'
        ? Response.json({ schemaVersion: 'import-plan-command-result.v3', outcome: 'accepted',
            commandId, status: 'applied', plan: { ...plan, state: 'completed' } })
        : Response.json(plan)
    })

    const current = await gateway.importPlan(commandId)
    expect(current.matches).toHaveLength(100)
    expect(current.providerDetails).toEqual({ pending: 100, available: 0, unavailable: 1 })
    expect(current.summary.add).toBe(101)
    expect(current.approvalEligible).toBe(true)
    expect(current.mappings).toEqual([{ sourceListId: 'source-list', selected: true,
      target: { kind: 'new', collectionId, name: '도쿄 여행' } }])
    const receipt = await gateway.approveImport({
      commandId, planId: commandId, expectedPlanRevision: 'plan-r1',
    })
    expect(receipt.state).toBe('completed')
    expect(requests).toEqual([
      { path: `/api/v3/transfers/import-plans/${commandId}` },
      { path: '/api/v3/transfers/import-plan-commands', body: {
        schemaVersion: 'import-plan-command.v3', commandId, kind: 'approve',
        planId: commandId, expectedPlanRevision: 'plan-r1',
      } },
    ])
  })

  it('preserves authentication failures as a distinct settings problem', async () => {
    const gateway = createDataTransferSettingsGateway(async () => Response.json({}, { status: 401 }))
    await expect(gateway.targetLists(connectionId)).rejects.toMatchObject({ status: 401 })
  })
})

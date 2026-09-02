import { describe, expect, it } from 'vitest'

import {
  outboundPlaceSelectionV2Schema,
  providerCapabilityListV2Schema,
  providerConnectionV2Schema,
  sourceSnapshotDetailV2Schema,
} from '../src/transfers/index.js'

const id = '01992d42-0000-7000-8000-000000000001'

describe('provider transfer contracts', () => {
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
      sourceRevision: 'source', listCount: lists.length, itemCount: 10_500,
      unresolvedItemCount: 10_500, observedAt: '2026-09-03T00:00:00.000Z',
      capturedAt: '2026-09-03T00:00:00.000Z', lists,
    }).success).toBe(false)
  })
})

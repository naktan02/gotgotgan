import { describe, expect, it } from 'vitest'

import { NaverSavedPlaceSnapshotNormalizer } from '../saved-place-snapshot-normalizer.js'

describe('NAVER immutable snapshot normalizer', () => {
  it('maps the existing collector page to the provider-neutral v2 snapshot payload', () => {
    const payload = new NaverSavedPlaceSnapshotNormalizer().normalize({
      acquisitionKind: 'browser-network',
      itemCount: 1,
      payload: JSON.stringify({
        schemaVersion: 'place-naver-saved-capture.v1', kind: 'page', nextCursor: null,
        lists: [{
          listId: 'list-a', name: '도쿄 여행', position: 0,
          bookmarks: [{
            bookmarkId: 'item-a', placeId: 'provider-place-a', name: '센소지', position: 0,
            address: '도쿄도 다이토구', category: '관광지', latitude: 35.7148, longitude: 139.7967,
          }],
        }],
      }),
    })
    expect(payload).toEqual({
      lists: [{
        sourceListId: 'list-a', observedName: '도쿄 여행', sourcePosition: 0,
        items: [{
          sourceItemId: 'item-a', providerPlaceId: 'provider-place-a', observedName: '센소지',
          observedAddress: '도쿄도 다이토구', observedCategory: '관광지',
          observedLocation: { latitude: 35.7148, longitude: 139.7967 }, sourcePosition: 0,
        }],
      }],
    })
  })

  it('fails closed when the collector payload shape drifts', () => {
    const normalizer = new NaverSavedPlaceSnapshotNormalizer()
    expect(() => normalizer.normalize({
      acquisitionKind: 'browser-network',
      itemCount: 0,
      payload: JSON.stringify({
        schemaVersion: 'place-naver-saved-capture.v1', kind: 'page',
        lists: [], nextCursor: null, unexpectedPrivateField: 'must-not-pass',
      }),
    })).toThrow()
  })
})

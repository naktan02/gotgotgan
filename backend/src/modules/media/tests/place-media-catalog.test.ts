import { describe, expect, it } from 'vitest'

import {
  InvalidPlaceMediaError,
  createPlaceMediaCatalog,
  type MediaRightsRevision,
  type PlaceMediaSource,
  type PlaceMediaStore,
} from '../index.js'

const source: PlaceMediaSource = {
  mediaId: '01992d20-4000-7000-8000-000000000001',
  placeId: '01992d20-4000-7000-8000-000000000002',
  sourceAssertionId: '01992d20-4000-7000-8000-000000000004',
  source: {
    kind: 'provider-media',
    sourceObservationId: '01992d20-4000-7000-8000-000000000003',
    providerKey: 'google',
    providerMediaIdentity: 'places/abc/photos/photo-1',
  },
  mediaType: 'image',
  size: { width: 1200, height: 800 },
  contentFingerprint: null,
  observedAt: '2026-09-03T00:00:00.000Z',
  sourceFingerprint: 'a'.repeat(64),
  createdAt: '2026-09-03T00:01:00.000Z',
}

const rights: MediaRightsRevision = {
  mediaId: source.mediaId,
  revision: 1,
  expectedPreviousRevision: null,
  state: 'allowed',
  allowedSurfaces: ['place-detail', 'library-card'],
  basis: 'provider-terms',
  attributionRequired: true,
  licenseUri: null,
  validFrom: '2026-09-03T00:00:00.000Z',
  validUntil: '2027-09-03T00:00:00.000Z',
  decidedBy: { kind: 'policy', reference: 'google-media-policy-v1' },
  decidedAt: '2026-09-03T00:01:00.000Z',
  fingerprint: 'b'.repeat(64),
  attributions: [{ label: 'Example Maps', uri: 'https://example.com' }],
}

function store(): PlaceMediaStore {
  return {
    recordSource: async (value) => ({ status: 'recorded', mediaId: value.mediaId }),
    decideRights: async (value) => ({ status: 'decided', mediaId: value.mediaId, revision: value.revision }),
    listDisplayable: async () => [],
  }
}

describe('PlaceMediaCatalog', () => {
  it('records opaque Provider media identity instead of a transient URL', async () => {
    const catalog = createPlaceMediaCatalog(store())
    await expect(catalog.recordSource(source)).resolves.toEqual({
      status: 'recorded', mediaId: source.mediaId,
    })
    await expect(catalog.recordSource({
      ...source,
      source: {
        kind: 'provider-media',
        sourceObservationId: '01992d20-4000-7000-8000-000000000003',
        providerKey: 'google',
        providerMediaIdentity: 'https://temporary.example/photo',
      },
    })).rejects.toBeInstanceOf(InvalidPlaceMediaError)
  })

  it('requires an allowed surface, known basis, and attribution when rights allow display', async () => {
    const catalog = createPlaceMediaCatalog(store())
    await expect(catalog.decideRights(rights)).resolves.toMatchObject({ status: 'decided' })
    await expect(catalog.decideRights({
      ...rights,
      basis: 'unknown',
      attributions: [],
    })).rejects.toBeInstanceOf(InvalidPlaceMediaError)
  })

  it('requires non-allowed decisions to expose no display surfaces', async () => {
    const catalog = createPlaceMediaCatalog(store())
    await expect(catalog.decideRights({
      ...rights,
      state: 'blocked',
    })).rejects.toBeInstanceOf(InvalidPlaceMediaError)
    await expect(catalog.decideRights({
      ...rights,
      attributions: Array.from({ length: 17 }, (_, index) => ({
        label: `Source ${index}`,
        uri: null,
      })),
    })).rejects.toBeInstanceOf(InvalidPlaceMediaError)
  })

  it('rejects non-canonical timestamps and invalid display queries', async () => {
    const catalog = createPlaceMediaCatalog(store())
    await expect(catalog.recordSource({
      ...source,
      createdAt: 'September 3, 2026',
    })).rejects.toBeInstanceOf(InvalidPlaceMediaError)
    await expect(catalog.listDisplayable({
      placeId: 'not-a-place-id',
      surface: 'place-detail',
      at: '2026-09-03T00:00:00.000Z',
      limit: 10,
    })).rejects.toThrow('Displayable media query is invalid.')
  })
})

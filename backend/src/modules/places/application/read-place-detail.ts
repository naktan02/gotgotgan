import type {
  PlaceDetailPersonalSource,
  PlaceDetailReadResult,
} from '../domain/place-detail.js'
import type { CanonicalResolutionStore } from './ports/canonical-resolution-store.js'
import type {
  PlaceDetailDocumentReader,
  PlaceDetailPersonalReader,
} from './ports/place-detail-sources.js'

export type PlaceDetailReader = (input: Readonly<{
  requestedPlaceId: string
  memberId?: string
}>) => Promise<PlaceDetailReadResult>

function projectPersonalState(personal: PlaceDetailPersonalSource) {
  return {
    saved: personal.preferences?.saved ?? false,
    wanted: personal.preferences?.wanted ?? false,
    personalRating: personal.preferences?.personalRating ?? null,
    preferencesUpdatedAt: personal.preferences?.updatedAt ?? null,
    visits: personal.visits,
  }
}

export function createPlaceDetailReader(dependencies: Readonly<{
  canonical: Pick<CanonicalResolutionStore, 'resolve'>
  readDocument: PlaceDetailDocumentReader
  readPersonal: PlaceDetailPersonalReader
}>): PlaceDetailReader {
  return async ({ requestedPlaceId, memberId }) => {
    const resolution = await dependencies.canonical.resolve(requestedPlaceId)
    if (resolution.status === 'not-found') return { status: 'not-found' }
    if (resolution.status === 'retired') {
      return { status: 'retired', placeId: resolution.placeId }
    }

    const personal = memberId === undefined
      ? undefined
      : await dependencies.readPersonal(memberId, resolution.placeId)
    const document = await dependencies.readDocument(resolution.placeId)
    if (document === undefined || document.placeId !== resolution.placeId) {
      if (personal === undefined) return { status: 'unavailable', placeId: resolution.placeId }
      return {
        status: 'found',
        detail: {
          schemaVersion: 'place-detail.v1',
          status: 'pending',
          requestedPlaceId,
          placeId: resolution.placeId,
          redirectedFrom: resolution.redirectedFrom,
          personalState: projectPersonalState(personal),
        },
      }
    }

    const detail = {
      schemaVersion: 'place-detail.v1' as const,
      status: resolution.redirectedFrom.length === 0 ? 'available' as const : 'redirected' as const,
      requestedPlaceId,
      placeId: resolution.placeId,
      redirectedFrom: resolution.redirectedFrom,
      name: document.name,
      areaLabel: document.areaLabel,
      location: document.location,
      primaryTaxonomy: document.primaryTaxonomy,
      taxonomyKeys: document.taxonomyKeys,
      evidence: {
        status: document.evidenceStatus,
        projectedAt: document.projectedAt,
      },
      ...(personal === undefined ? {} : {
        personalState: projectPersonalState(personal),
      }),
    }
    return { status: 'found' as const, detail }
  }
}

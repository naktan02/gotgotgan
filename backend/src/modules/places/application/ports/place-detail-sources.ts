import type {
  PlaceDetailDocument,
  PlaceDetailPersonalSource,
} from '../../domain/place-detail.js'

export type PlaceDetailDocumentReader = (
  placeId: string,
) => Promise<PlaceDetailDocument | undefined>

export type PlaceDetailPersonalReader = (
  memberId: string,
  placeId: string,
) => Promise<PlaceDetailPersonalSource>

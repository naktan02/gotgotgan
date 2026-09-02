import type {
  DecideMediaRightsResult,
  DisplayablePlaceMedia,
  MediaRightsRevision,
  MediaSurface,
  PlaceMediaSource,
  RecordMediaSourceResult,
} from '../../domain/model.js'

export interface PlaceMediaStore {
  recordSource(source: PlaceMediaSource): Promise<RecordMediaSourceResult>
  decideRights(rights: MediaRightsRevision): Promise<DecideMediaRightsResult>
  listDisplayable(input: Readonly<{
    placeId: string
    surface: MediaSurface
    at: string
    limit: number
  }>): Promise<readonly DisplayablePlaceMedia[]>
}

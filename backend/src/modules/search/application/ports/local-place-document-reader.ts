import type { LocalPlaceSearchDocument } from '../../domain/model.js'

export interface LocalPlaceDocumentReader {
  getPlaceDocument(placeId: string): Promise<LocalPlaceSearchDocument | undefined>
  getPlaceDocuments(placeIds: readonly string[]): Promise<readonly LocalPlaceSearchDocument[]>
}

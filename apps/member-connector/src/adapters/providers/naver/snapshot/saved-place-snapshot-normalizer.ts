import { connectorCaptureChunkPayloadV2Schema } from '@place/contracts/transfers'
import { z } from 'zod'

import type { SavedPlaceSnapshotNormalizer } from '../../../../application/import-snapshot/index.js'
import type { SavedPlaceCapturePayload } from '../../../../application/ports/saved-place-source.js'

const bookmarkSchema = z.object({
  bookmarkId: z.string().min(1).max(512),
  placeId: z.string().min(1).max(512).optional(),
  name: z.string().min(1).max(300),
  position: z.number().int().nonnegative(),
  address: z.string().min(1).max(500).optional(),
  category: z.string().min(1).max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).strict().superRefine((bookmark, context) => {
  if ((bookmark.latitude === undefined) !== (bookmark.longitude === undefined)) {
    context.addIssue({ code: 'custom', message: 'Location requires both coordinates.' })
  }
})

const naverCaptureSchema = z.object({
  schemaVersion: z.literal('place-naver-saved-capture.v1'),
  kind: z.literal('page'),
  lists: z.array(z.object({
    listId: z.string().min(1).max(512),
    name: z.string().min(1).max(200),
    position: z.number().int().nonnegative(),
    bookmarks: z.array(bookmarkSchema).max(1_000),
  }).strict()).max(100),
  nextCursor: z.null(),
}).strict()

export class NaverSavedPlaceSnapshotNormalizer implements SavedPlaceSnapshotNormalizer {
  readonly providerKey = 'naver' as const

  normalize(capture: SavedPlaceCapturePayload) {
    const parsed = naverCaptureSchema.parse(JSON.parse(capture.payload) as unknown)
    return connectorCaptureChunkPayloadV2Schema.parse({
      lists: parsed.lists.map((list) => ({
        sourceListId: list.listId,
        observedName: list.name,
        sourcePosition: list.position,
        items: list.bookmarks.map((bookmark) => ({
          sourceItemId: bookmark.bookmarkId,
          providerPlaceId: bookmark.placeId ?? null,
          observedName: bookmark.name,
          observedAddress: bookmark.address ?? null,
          observedCategory: bookmark.category ?? null,
          observedLocation: bookmark.latitude === undefined || bookmark.longitude === undefined
            ? null
            : { latitude: bookmark.latitude, longitude: bookmark.longitude },
          sourcePosition: bookmark.position,
        })),
      })),
    })
  }
}

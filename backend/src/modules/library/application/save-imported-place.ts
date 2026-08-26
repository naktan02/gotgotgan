import { createHash } from 'node:crypto'

import type { ImportedPlaceSaveStore } from './ports/imported-place-save-store.js'

export function saveImportedPlace(input: Readonly<{
  commandId: string
  memberId: string
  canonicalPlaceId: string
  occurredAt: string
  store: ImportedPlaceSaveStore
}>) {
  const fingerprint = createHash('sha256').update(JSON.stringify({
    memberId: input.memberId,
    canonicalPlaceId: input.canonicalPlaceId,
  })).digest('hex')
  return input.store.saveImportedPlace({
    commandId: input.commandId,
    memberId: input.memberId,
    canonicalPlaceId: input.canonicalPlaceId,
    occurredAt: input.occurredAt,
    fingerprint,
  })
}

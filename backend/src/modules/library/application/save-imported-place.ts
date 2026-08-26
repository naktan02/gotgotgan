import { createHash } from 'node:crypto'

import type { ImportedPlaceSaveStore } from './ports/imported-place-save-store.js'

export function saveImportedPlace(input: Readonly<{
  commandId: string
  memberId: string
  canonicalPlaceId: string
  occurredAt: string
  source: Readonly<{
    providerKey: 'naver' | 'kakao' | 'google'
    connectionId: string
    listId: string
    listName: string
    listPosition: number
    position: number
  }>
  store: ImportedPlaceSaveStore
}>) {
  const listName = input.source.listName.trim()
  const listId = input.source.listId.trim()
  if (
    listName.length === 0 || listName.length > 200 ||
    listId.length === 0 || listId.length > 512 ||
    !Number.isInteger(input.source.listPosition) || input.source.listPosition < 0 ||
    !Number.isInteger(input.source.position) || input.source.position < 0
  ) throw new Error('Imported place source list is invalid.')
  const source = {
    ...input.source,
    listId,
    listName,
    collectionName: [...listName].slice(0, 120).join(''),
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    memberId: input.memberId,
    canonicalPlaceId: input.canonicalPlaceId,
    source,
  })).digest('hex')
  return input.store.saveImportedPlace({
    commandId: input.commandId,
    memberId: input.memberId,
    canonicalPlaceId: input.canonicalPlaceId,
    occurredAt: input.occurredAt,
    fingerprint,
    source,
  })
}

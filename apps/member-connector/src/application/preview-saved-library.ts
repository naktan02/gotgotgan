import type { SavedPlaceSnapshotNormalizer } from './import-snapshot/index.js'
import type { ProviderSession } from './ports/provider-session.js'
import type { SavedPlaceSource } from './ports/saved-place-source.js'
import { SavedPlaceSourceError } from './ports/saved-place-source.js'

export type SavedLibraryPreview = Readonly<{
  listCount: number
  itemCount: number
  missingIdentityCount: number
  serverSaved: false
}>

/** Local validation only; this is deliberately not a sealed or server-committed snapshot. */
export async function previewSavedLibrary(input: Readonly<{
  source: SavedPlaceSource
  session: ProviderSession
  normalizer: SavedPlaceSnapshotNormalizer
  signal: AbortSignal
}>): Promise<SavedLibraryPreview> {
  if (input.source.providerKey !== input.session.providerKey ||
    input.source.providerKey !== input.normalizer.providerKey) throw new Error('Provider binding mismatch.')
  input.signal.throwIfAborted()
  const sessionState = await input.session.probe({ signal: input.signal })
  if (sessionState === 'unavailable') {
    throw new SavedPlaceSourceError('provider-unavailable', true, 'Provider session check unavailable.')
  }
  if (sessionState === 'reauth-required') {
    throw new SavedPlaceSourceError('reauth-required', false, 'Provider login requires user action.')
  }
  const listIds = new Set<string>()
  let itemCount = 0
  let missingIdentityCount = 0
  let byteCount = 0
  for await (const capture of input.source.collect({ signal: input.signal })) {
    input.signal.throwIfAborted()
    byteCount += new TextEncoder().encode(capture.payload).byteLength
    if (byteCount > 64 * 1_048_576) throw new Error('Capture limit exceeded.')
    const normalized = input.normalizer.normalize(capture)
    for (const list of normalized.lists) {
      listIds.add(list.sourceListId)
      itemCount += list.items.length
      missingIdentityCount += list.items.filter((item) => item.providerPlaceId === null).length
      if (listIds.size > 500 || itemCount > 100_000) throw new Error('Capture limit exceeded.')
    }
  }
  input.signal.throwIfAborted()
  return { listCount: listIds.size, itemCount, missingIdentityCount, serverSaved: false }
}

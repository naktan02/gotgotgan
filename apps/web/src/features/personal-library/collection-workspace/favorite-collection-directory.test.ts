import { describe, expect, it, vi } from 'vitest'

import { CollectionLibraryProblem } from './collection-library-http'
import { createFavoriteCollectionDirectory } from './favorite-collection-directory'

describe('favorite collection directory', () => {
  it('projects only the category summary needed outside the library', async () => {
    const workspace = vi.fn().mockResolvedValue({
      collections: [{ collectionId: 'collection-1', name: '서울 라멘', placeCount: 8 }],
    })
    const directory = createFavoriteCollectionDirectory({ workspace })

    await expect(directory.readCollections(new AbortController().signal)).resolves.toEqual({
      kind: 'ready',
      items: [{ collectionId: 'collection-1', name: '서울 라멘', placeCount: 8 }],
    })
  })

  it('hides transport failures behind stable access states', async () => {
    const signal = new AbortController().signal
    const signedOut = createFavoriteCollectionDirectory({
      workspace: vi.fn().mockRejectedValue(new CollectionLibraryProblem(401)),
    })
    const unavailable = createFavoriteCollectionDirectory({
      workspace: vi.fn().mockRejectedValue(new CollectionLibraryProblem(503)),
    })

    await expect(signedOut.readCollections(signal)).resolves.toEqual({ kind: 'signed-out' })
    await expect(unavailable.readCollections(signal)).resolves.toEqual({ kind: 'unavailable' })
  })
})

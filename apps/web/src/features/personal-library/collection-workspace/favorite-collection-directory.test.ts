import { describe, expect, it, vi } from 'vitest'

import { CollectionLibraryProblem } from './collection-library-http'
import { createFavoriteCollectionDirectory } from './favorite-collection-directory'

describe('favorite collection directory', () => {
  it('projects only the category summary needed outside the library', async () => {
    const workspace = vi.fn().mockResolvedValue({
      collections: [{ collectionId: 'collection-1', name: '서울 라멘', placeCount: 8 }],
    })
    const directory = createFavoriteCollectionDirectory({ workspace, mapV4: vi.fn() })

    await expect(directory.readCollections(new AbortController().signal)).resolves.toEqual({
      kind: 'ready',
      items: [{ collectionId: 'collection-1', name: '서울 라멘', placeCount: 8 }],
    })
  })

  it('hides transport failures behind stable access states', async () => {
    const signal = new AbortController().signal
    const signedOut = createFavoriteCollectionDirectory({
      workspace: vi.fn().mockRejectedValue(new CollectionLibraryProblem(401)),
      mapV4: vi.fn(),
    })
    const unavailable = createFavoriteCollectionDirectory({
      workspace: vi.fn().mockRejectedValue(new CollectionLibraryProblem(503)),
      mapV4: vi.fn(),
    })

    await expect(signedOut.readCollections(signal)).resolves.toEqual({ kind: 'signed-out' })
    await expect(unavailable.readCollections(signal)).resolves.toEqual({ kind: 'unavailable' })
  })

  it('loads both Collection pages up to the map selection limit', async () => {
    const workspace = vi.fn()
      .mockResolvedValueOnce({
        collections: [{ collectionId: 'collection-1', name: '첫 목록', placeCount: 8 }],
        collectionNextCursor: 'next-page',
      })
      .mockResolvedValueOnce({
        collections: [{ collectionId: 'collection-2', name: '둘째 목록', placeCount: 3 }],
      })
    const directory = createFavoriteCollectionDirectory({ workspace, mapV4: vi.fn() })

    await expect(directory.readCollections(new AbortController().signal)).resolves.toMatchObject({
      kind: 'ready',
      items: [{ name: '첫 목록' }, { name: '둘째 목록' }],
    })
    expect(workspace).toHaveBeenNthCalledWith(2, expect.objectContaining({
      collectionCursor: 'next-page', limit: 50,
    }), expect.any(AbortSignal))
  })
})

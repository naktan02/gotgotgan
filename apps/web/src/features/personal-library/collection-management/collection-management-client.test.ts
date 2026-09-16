import { describe, expect, it, vi } from 'vitest'

import { createCollectionManagementClient } from './collection-management-client'

const collectionId = '11111111-1111-4111-8111-111111111111'
const placeId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'

function json(value: unknown, status = 200) {
  return Response.json(value, { status })
}

describe('Collection management client', () => {
  it('keeps visibility updates on the revision-aware same-origin command seam', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({
      schemaVersion: 'collection-lifecycle-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId, status: 'applied' },
      collection: {
        collectionId,
        name: '도쿄 여행',
        description: null,
        visibility: 'unlisted',
        publicationId: '44444444-4444-4444-8444-444444444444',
        placeCount: 1,
        collectionRevision: 'revision-2',
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
    }, 201))
    const client = createCollectionManagementClient(fetcher)

    const result = await client.setVisibility({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'update',
      commandId,
      collectionId,
      expectedCollectionRevision: 'revision-1',
      visibility: 'unlisted',
    })

    expect(result.outcome).toBe('accepted')
    expect(fetcher).toHaveBeenCalledWith('/api/library/collection-commands', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"expectedCollectionRevision":"revision-1"'),
    }))
  })

  it('loads ordered positions and serializes move and remove commands through one adapter', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        schemaVersion: 'library-collection-detail.v1',
        collection: {
          collectionId,
          name: '도쿄 여행',
          description: null,
          visibility: 'private',
          publicationId: null,
          placeCount: 0,
          updatedAt: '2026-09-05T00:00:00.000Z',
        },
        places: [],
      }))
      .mockImplementation(async () => json({
        schemaVersion: 'library-command-result.v1',
        status: 'applied',
      }, 201))
    const client = createCollectionManagementClient(fetcher)

    await client.detail(collectionId)
    await client.command({
      commandId,
      command: { kind: 'move-collection-place', collectionId, placeId, position: 2 },
    })
    await client.command({
      commandId: '55555555-5555-4555-8555-555555555555',
      command: { kind: 'remove-collection-place', collectionId, placeId },
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/library/collections/${collectionId}?limit=50`)
    expect(fetcher.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining('"kind":"move-collection-place"'),
    }))
    expect(fetcher.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining('"kind":"remove-collection-place"'),
    }))
  })
})

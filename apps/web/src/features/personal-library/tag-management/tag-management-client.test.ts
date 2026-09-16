import { describe, expect, it, vi } from 'vitest'

import { createTagManagementClient } from './tag-management-client'

const tagId = '11111111-1111-4111-8111-111111111111'

describe('Tag management client', () => {
  it('paginates tags and validates lifecycle commands before same-origin POSTs', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'library-tag-list.v1',
        items: [{
          tagId,
          name: '아이와 함께',
          placeCount: 2,
          createdAt: '2026-09-05T00:00:00.000Z',
        }],
      }))
      .mockImplementation(async () => Response.json({
        schemaVersion: 'library-command-result.v1',
        status: 'applied',
      }, { status: 201 }))
    const client = createTagManagementClient(fetcher)

    const page = await client.list('next-page')
    await client.command({
      commandId: '22222222-2222-4222-8222-222222222222',
      command: { kind: 'create-tag', tagId, name: '아이와 함께' },
    })
    await client.command({
      commandId: '33333333-3333-4333-8333-333333333333',
      command: { kind: 'rename-tag', tagId, name: '가족 나들이' },
    })
    await client.command({
      commandId: '44444444-4444-4444-8444-444444444444',
      command: { kind: 'delete-tag', tagId },
    })

    expect(page.items[0]?.name).toBe('아이와 함께')
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/library/tags?limit=50&cursor=next-page')
    expect(fetcher.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining('"kind":"create-tag"'),
    }))
    expect(fetcher.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining('"kind":"rename-tag"'),
    }))
    expect(fetcher.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining('"kind":"delete-tag"'),
    }))
  })
})

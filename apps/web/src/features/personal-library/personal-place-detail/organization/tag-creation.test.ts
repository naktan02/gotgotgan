import { describe, expect, it } from 'vitest'
import type { BrowserLibraryCommandRequest } from '@place/contracts/http'
import { createTagCreation } from './tag-creation'

describe('Creating and attaching a personal tag', () => {
  it('reuses the creation command after a lost response, then attaches exactly that tag', async () => {
    const sent: BrowserLibraryCommandRequest[] = []
    const save = createTagCreation('진한 국물', 'place-1', async (request) => {
      sent.push(request)
      if (sent.length === 1) throw new Error('response lost')
    })
    await expect(save()).rejects.toThrow('response lost')
    await save()
    expect(sent[0]).toEqual(sent[1])
    expect(sent.map((item) => item.command.kind)).toEqual(['create-tag', 'create-tag', 'tag-place'])
    expect(sent[2]!.command).toMatchObject({ kind: 'tag-place', placeId: 'place-1', tagId: (sent[0]!.command as { tagId: string }).tagId })
  })

  it('does not create another tag when only attachment needs retrying', async () => {
    const sent: BrowserLibraryCommandRequest[] = []
    const save = createTagCreation('조용한 곳', 'place-1', async (request) => {
      sent.push(request)
      if (sent.length === 2) throw new Error('attachment unavailable')
    })
    await expect(save()).rejects.toThrow('attachment unavailable')
    await save()
    expect(sent.map((item) => item.command.kind)).toEqual(['create-tag', 'tag-place', 'tag-place'])
    expect(sent[1]).toEqual(sent[2])
  })
})

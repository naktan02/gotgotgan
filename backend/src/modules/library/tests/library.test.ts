import { describe, expect, it } from 'vitest'

import {
  applyLibraryCommand,
  LibraryCommandConflictError,
  type LibraryAttempt,
  type LibraryCommand,
  type LibraryCommandOutcome,
  type LibraryStore,
  type PublishedCollection,
} from '../index.js'

class MemoryLibraryStore implements LibraryStore {
  readonly attempts = new Map<string, LibraryAttempt>()
  readonly commands: LibraryCommand[] = []
  published?: PublishedCollection

  async apply(attempt: LibraryAttempt): Promise<LibraryCommandOutcome> {
    const prior = this.attempts.get(attempt.commandId)
    if (prior !== undefined) {
      return prior.fingerprint === attempt.fingerprint ? { status: 'replayed' } : { status: 'conflict' }
    }
    this.attempts.set(attempt.commandId, attempt)
    this.commands.push(attempt.command)
    return { status: 'applied' }
  }

  async getPublishedCollection(publicationId: string) {
    return this.published?.publicationId === publicationId ? this.published : undefined
  }

  async getMemberLibrary() {
    return { places: [], collections: [], tags: [] }
  }
}

const context = {
  memberId: '01992d00-0000-7000-8000-000000000001',
  occurredAt: '2026-08-26T10:00:00.000Z',
}

describe('personal library', () => {
  it('keeps saved, wanted, and personal rating independent', async () => {
    const store = new MemoryLibraryStore()
    await expect(applyLibraryCommand({
      ...context,
      commandId: '01992d00-0000-7000-8000-000000000002',
      command: {
        kind: 'set-place-preferences',
        placeId: '01992d00-0000-7000-8000-000000000003',
        saved: true,
        wanted: false,
        personalRating: 4.4,
      },
      store,
    })).resolves.toEqual({ status: 'applied' })

    expect(store.commands).toEqual([expect.objectContaining({
      saved: true,
      wanted: false,
      personalRating: 4.4,
    })])
  })

  it('supports collections, tags, and independent copying by publication id', async () => {
    const store = new MemoryLibraryStore()
    const commands: LibraryCommand[] = [
      {
        kind: 'create-collection',
        collectionId: '01992d00-0000-7000-8000-000000000010',
        name: 'Seoul ramen',
        description: 'Places worth revisiting',
        visibility: 'unlisted',
        publicationId: '01992d00-0000-7000-8000-000000000011',
      },
      {
        kind: 'add-collection-place',
        collectionId: '01992d00-0000-7000-8000-000000000010',
        placeId: '01992d00-0000-7000-8000-000000000012',
        position: 0,
      },
      {
        kind: 'create-tag',
        tagId: '01992d00-0000-7000-8000-000000000013',
        name: '늦은 저녁',
      },
      {
        kind: 'tag-place',
        tagId: '01992d00-0000-7000-8000-000000000013',
        placeId: '01992d00-0000-7000-8000-000000000012',
      },
      {
        kind: 'copy-published-collection',
        sourcePublicationId: '01992d00-0000-7000-8000-000000000020',
        targetCollectionId: '01992d00-0000-7000-8000-000000000021',
        targetName: 'Copied map',
      },
    ]
    for (const [index, command] of commands.entries()) {
      await applyLibraryCommand({
        ...context,
        commandId: `01992d00-0000-7000-8000-${String(index + 30).padStart(12, '0')}`,
        command,
        store,
      })
    }
    expect(store.commands).toEqual(commands)
  })

  it('rejects invalid visibility and conflicting command reuse', async () => {
    const store = new MemoryLibraryStore()
    const commandId = '01992d00-0000-7000-8000-000000000040'
    const privateWithPublication = {
      ...context,
      commandId,
      command: {
        kind: 'create-collection' as const,
        collectionId: '01992d00-0000-7000-8000-000000000041',
        name: 'Private',
        visibility: 'private' as const,
        publicationId: '01992d00-0000-7000-8000-000000000042',
      },
      store,
    }
    await expect(applyLibraryCommand(privateWithPublication)).rejects.toMatchObject({
      name: 'InvalidLibraryCommandError',
    })

    const first = {
      ...context,
      commandId,
      command: {
        kind: 'set-place-preferences' as const,
        placeId: '01992d00-0000-7000-8000-000000000043',
        saved: true,
        wanted: true,
        personalRating: null,
      },
      store,
    }
    await applyLibraryCommand(first)
    await expect(applyLibraryCommand({
      ...first,
      command: { ...first.command, wanted: false },
    })).rejects.toBeInstanceOf(LibraryCommandConflictError)
  })

  it('returns only an explicit published collection projection', async () => {
    const store = new MemoryLibraryStore()
    store.published = {
      publicationId: '01992d00-0000-7000-8000-000000000050',
      visibility: 'public',
      name: 'Public places',
      description: null,
      places: [{ placeId: '01992d00-0000-7000-8000-000000000051', position: 0 }],
      updatedAt: '2026-08-26T10:00:00.000Z',
    }
    await expect(store.getPublishedCollection(store.published.publicationId)).resolves.toEqual(store.published)
    await expect(store.getPublishedCollection('01992d00-0000-7000-8000-000000000099')).resolves.toBeUndefined()
  })
})

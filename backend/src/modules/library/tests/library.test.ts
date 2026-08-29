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

  async getPlacePreferences() {
    return undefined
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
        expectedUpdatedAt: null,
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

  it('canonicalizes the observed preference timestamp before fingerprinting and storing', async () => {
    const store = new MemoryLibraryStore()
    await applyLibraryCommand({
      ...context,
      commandId: '01992d00-0000-7000-8000-000000000004',
      command: {
        kind: 'set-place-preferences',
        placeId: '01992d00-0000-7000-8000-000000000005',
        expectedUpdatedAt: '2026-08-26T19:00:00+09:00',
        saved: true,
        wanted: false,
        personalRating: null,
      },
      store,
    })
    expect(store.commands[0]).toMatchObject({
      expectedUpdatedAt: '2026-08-26T10:00:00.000Z',
    })
  })

  it('supports collections, tags, and independent copying by publication id', async () => {
    const store = new MemoryLibraryStore()
    const commands: LibraryCommand[] = [
      {
        kind: 'create-collection',
        collectionId: '01992d00-0000-7000-8000-000000000010',
        name: 'Seoul ramen',
        description: 'Places worth revisiting',
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
        kind: 'rename-collection',
        collectionId: '01992d00-0000-7000-8000-000000000010',
        name: '성수 라멘',
      },
      {
        kind: 'set-collection-publication',
        collectionId: '01992d00-0000-7000-8000-000000000010',
        expectedUpdatedAt: '2026-08-26T19:00:00+09:00',
        visibility: 'public',
      },
      {
        kind: 'move-collection-place',
        collectionId: '01992d00-0000-7000-8000-000000000010',
        placeId: '01992d00-0000-7000-8000-000000000012',
        position: 2,
      },
      {
        kind: 'rename-tag',
        tagId: '01992d00-0000-7000-8000-000000000013',
        name: '쇼유라멘',
      },
      {
        kind: 'untag-place',
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
    expect(store.commands).toEqual(commands.map((command) => (
      command.kind === 'set-collection-publication'
        ? { ...command, expectedUpdatedAt: '2026-08-26T10:00:00.000Z' }
        : command
    )))
  })

  it('rejects invalid Collection input and conflicting command reuse', async () => {
    const store = new MemoryLibraryStore()
    const commandId = '01992d00-0000-7000-8000-000000000040'
    const invalidCollection = {
      ...context,
      commandId,
      command: {
        kind: 'create-collection' as const,
        collectionId: '01992d00-0000-7000-8000-000000000041',
        name: ' ',
      },
      store,
    }
    await expect(applyLibraryCommand(invalidCollection)).rejects.toMatchObject({
      name: 'InvalidLibraryCommandError',
    })

    const first = {
      ...context,
      commandId,
      command: {
        kind: 'set-place-preferences' as const,
        placeId: '01992d00-0000-7000-8000-000000000043',
        expectedUpdatedAt: null,
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

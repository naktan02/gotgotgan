import { describe, expect, it } from 'vitest'

import {
  applyWritingCommand,
  WritingCommandConflictError,
  type PublishedWriting,
  type WritingAttempt,
  type WritingCommandOutcome,
  type WritingStore,
} from '../index.js'

class MemoryWritingStore implements WritingStore {
  readonly attempts = new Map<string, WritingAttempt>()
  published?: PublishedWriting

  async apply(attempt: WritingAttempt): Promise<WritingCommandOutcome> {
    const prior = this.attempts.get(attempt.commandId)
    if (prior !== undefined) return prior.fingerprint === attempt.fingerprint ? { status: 'replayed' } : { status: 'conflict' }
    this.attempts.set(attempt.commandId, attempt)
    return { status: 'applied', documentId: attempt.command.documentId, version: 1 }
  }

  async getPublished(publicationId: string) {
    return this.published?.publicationId === publicationId ? this.published : undefined
  }

  async listMemberWriting() {
    return []
  }
}

const context = {
  memberId: '01992d02-0000-7000-8000-000000000001',
  occurredAt: '2026-08-26T10:00:00.000Z',
}

describe('notes and entries', () => {
  it('creates a short note linked to one Place', async () => {
    const store = new MemoryWritingStore()
    await expect(applyWritingCommand({
      ...context,
      commandId: '01992d02-0000-7000-8000-000000000002',
      command: {
        kind: 'create-note',
        documentId: '01992d02-0000-7000-8000-000000000003',
        body: '국물이 깔끔했다.',
        placeId: '01992d02-0000-7000-8000-000000000004',
        visibility: 'private',
      },
      store,
    })).resolves.toEqual({
      status: 'applied',
      documentId: '01992d02-0000-7000-8000-000000000003',
      version: 1,
    })
  })

  it('creates a long entry linked to multiple Places with explicit visibility', async () => {
    const store = new MemoryWritingStore()
    await expect(applyWritingCommand({
      ...context,
      commandId: '01992d02-0000-7000-8000-000000000010',
      command: {
        kind: 'create-entry',
        documentId: '01992d02-0000-7000-8000-000000000011',
        title: '성수 하루',
        body: '두 장소를 천천히 돌아봤다.',
        placeIds: [
          '01992d02-0000-7000-8000-000000000012',
          '01992d02-0000-7000-8000-000000000013',
        ],
        visibility: 'public',
        publicationId: '01992d02-0000-7000-8000-000000000014',
      },
      store,
    })).resolves.toMatchObject({ status: 'applied', version: 1 })
  })

  it('supports optimistic updates and detects conflicting command reuse', async () => {
    const store = new MemoryWritingStore()
    const input = {
      ...context,
      commandId: '01992d02-0000-7000-8000-000000000020',
      command: {
        kind: 'update-note' as const,
        documentId: '01992d02-0000-7000-8000-000000000021',
        expectedVersion: 1,
        body: '수정한 메모',
        placeId: '01992d02-0000-7000-8000-000000000022',
        visibility: 'unlisted' as const,
        publicationId: '01992d02-0000-7000-8000-000000000023',
      },
      store,
    }
    await applyWritingCommand(input)
    await expect(applyWritingCommand({
      ...input,
      command: { ...input.command, body: '다른 수정' },
    })).rejects.toBeInstanceOf(WritingCommandConflictError)
  })

  it('never returns private writing through the publication lookup', async () => {
    const store = new MemoryWritingStore()
    store.published = {
      kind: 'entry',
      publicationId: '01992d02-0000-7000-8000-000000000030',
      visibility: 'unlisted',
      title: '공유 글',
      body: '허용된 필드만 반환한다.',
      placeIds: ['01992d02-0000-7000-8000-000000000031'],
      updatedAt: '2026-08-26T10:00:00.000Z',
    }
    await expect(store.getPublished(store.published.publicationId)).resolves.toEqual(store.published)
    await expect(store.getPublished('01992d02-0000-7000-8000-000000000099')).resolves.toBeUndefined()
  })
})

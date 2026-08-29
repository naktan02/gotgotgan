import { describe, expect, it } from 'vitest'

import {
  readPublishedProfile,
  setPublicProfile,
  InvalidPublicProfileError,
  PublicProfileHandleImmutableError,
  type PublicProfileAttempt,
  type PublicProfileOutcome,
  type PublicProfileRecord,
  type PublicProfileStore,
  type PublishedProfileOwner,
} from '../index.js'

class MemoryProfileStore implements PublicProfileStore {
  current?: PublicProfileRecord
  attempts = new Map<string, PublicProfileAttempt>()

  async apply(attempt: PublicProfileAttempt): Promise<PublicProfileOutcome> {
    const prior = this.attempts.get(attempt.commandId)
    if (prior !== undefined) {
      return { status: prior.fingerprint === attempt.fingerprint ? 'replayed' : 'conflict' }
    }
    if (this.current !== undefined && this.current.handle !== attempt.command.handle) {
      return { status: 'handle-immutable' }
    }
    this.attempts.set(attempt.commandId, attempt)
    this.current = {
      handle: attempt.command.handle,
      displayName: attempt.command.displayName,
      visibility: attempt.command.visibility,
      createdAt: this.current?.createdAt ?? attempt.occurredAt,
      updatedAt: attempt.occurredAt,
    }
    return { status: 'applied' }
  }

  async getCurrent() { return this.current }

  async getPublished(): Promise<PublishedProfileOwner | undefined> {
    return this.current?.visibility === 'public'
      ? { ...this.current, visibility: 'public', ownerMemberId: 'member-1' }
      : undefined
  }
}

const base = {
  commandId: '01992d20-0000-7000-8000-000000000001',
  memberId: '01992d20-0000-7000-8000-000000000002',
  occurredAt: '2026-08-29T10:00:00.000Z',
}

describe('public profiles', () => {
  it('publishes a stable handle and composes only injected public Collections', async () => {
    const store = new MemoryProfileStore()
    await expect(setPublicProfile({
      ...base,
      command: { handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', expectedUpdatedAt: null },
      store,
    })).resolves.toEqual({ status: 'applied' })
    await expect(readPublishedProfile({
      handle: 'ramen-log', limit: 20, store,
      collections: async () => ({
        items: [{
          publicationId: '01992d20-0000-7000-8000-000000000003',
          name: '성수 라멘', description: null, placeCount: 3,
          updatedAt: '2026-08-29T10:00:00.000Z',
        }],
      }),
    })).resolves.toMatchObject({
      handle: 'ramen-log', displayName: '라멘 기록', collections: [{ name: '성수 라멘' }],
    })
  })

  it('keeps hidden profiles unavailable and rejects reserved or changed handles', async () => {
    const store = new MemoryProfileStore()
    await expect(setPublicProfile({
      ...base,
      command: { handle: 'search', displayName: '검색', visibility: 'hidden', expectedUpdatedAt: null },
      store,
    })).rejects.toBeInstanceOf(InvalidPublicProfileError)
    await setPublicProfile({
      ...base,
      command: { handle: 'quiet-map', displayName: '조용한 지도', visibility: 'hidden', expectedUpdatedAt: null },
      store,
    })
    await expect(readPublishedProfile({
      handle: 'quiet-map', limit: 20, store, collections: async () => ({ items: [] }),
    })).resolves.toBeUndefined()
    await expect(setPublicProfile({
      ...base,
      commandId: '01992d20-0000-7000-8000-000000000099',
      command: {
        handle: 'changed-map', displayName: '조용한 지도', visibility: 'public',
        expectedUpdatedAt: '2026-08-29T10:00:00.000Z',
      },
      store,
    })).rejects.toBeInstanceOf(PublicProfileHandleImmutableError)
  })
})

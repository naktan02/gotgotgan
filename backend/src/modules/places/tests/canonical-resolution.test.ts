import { describe, expect, it } from 'vitest'

import {
  applyCanonicalResolution,
  type CanonicalPlaceRecord,
  type CanonicalResolutionAttempt,
  type CanonicalResolutionStore,
} from '../index.js'

class MemoryCanonicalResolutionStore implements CanonicalResolutionStore {
  readonly places = new Map<string, CanonicalPlaceRecord>()
  readonly identities = new Map<string, string>()
  readonly redirects = new Map<string, string>()
  readonly decisions = new Map<string, CanonicalResolutionAttempt>()

  async apply(attempt: CanonicalResolutionAttempt) {
    const prior = this.decisions.get(attempt.decisionId)
    if (prior !== undefined) {
      return prior.fingerprint === attempt.fingerprint
        ? { status: 'replayed' as const }
        : { status: 'conflict' as const }
    }
    const command = attempt.command
    if (command.kind === 'create-place') {
      if (this.places.has(command.placeId)) return { status: 'conflict' as const }
      const key = `${command.providerIdentity.providerKey}:${command.providerIdentity.externalPlaceId}`
      if (this.identities.has(key)) return { status: 'identity-already-linked' as const }
      this.places.set(command.placeId, { id: command.placeId, status: 'active' })
      this.identities.set(key, command.placeId)
    } else if (command.kind === 'merge-places') {
      if (command.sourcePlaceId === command.targetPlaceId) return { status: 'invalid' as const }
      const source = this.places.get(command.sourcePlaceId)
      const target = this.places.get(command.targetPlaceId)
      if (source?.status !== 'active' || target?.status !== 'active') return { status: 'not-active' as const }
      source.status = 'redirected'
      this.redirects.set(source.id, target.id)
      for (const [identity, placeId] of this.identities) {
        if (placeId === source.id) this.identities.set(identity, target.id)
      }
    } else if (command.kind === 'split-provider-identity') {
      const key = `${command.providerIdentity.providerKey}:${command.providerIdentity.externalPlaceId}`
      if (this.identities.get(key) !== command.sourcePlaceId) return { status: 'identity-not-linked' as const }
      if (this.places.has(command.newPlaceId)) return { status: 'conflict' as const }
      this.places.set(command.newPlaceId, { id: command.newPlaceId, status: 'active' })
      this.identities.set(key, command.newPlaceId)
    } else if (command.kind === 'retire-place') {
      const place = this.places.get(command.placeId)
      if (place?.status !== 'active') return { status: 'not-active' as const }
      place.status = 'retired'
    } else {
      const key = `${command.providerIdentity.providerKey}:${command.providerIdentity.externalPlaceId}`
      const target = this.places.get(command.targetPlaceId)
      if (target?.status !== 'active') return { status: 'not-active' as const }
      const current = this.identities.get(key)
      if (current !== undefined && current !== command.targetPlaceId) {
        return { status: 'identity-already-linked' as const }
      }
      this.identities.set(key, command.targetPlaceId)
    }
    this.decisions.set(attempt.decisionId, attempt)
    return { status: 'applied' as const }
  }

  async resolve(placeId: string) {
    const path: string[] = []
    let current = placeId
    while (this.redirects.has(current)) {
      path.push(current)
      current = this.redirects.get(current)!
    }
    const place = this.places.get(current)
    if (place === undefined) return { status: 'not-found' as const }
    if (place.status === 'retired') {
      return { status: 'retired' as const, placeId: place.id, redirectedFrom: path }
    }
    return { status: 'active' as const, placeId: place.id, redirectedFrom: path }
  }

  async resolveProviderIdentity(providerIdentity: { providerKey: string; externalPlaceId: string }) {
    const placeId = this.identities.get(
      `${providerIdentity.providerKey}:${providerIdentity.externalPlaceId}`,
    )
    return placeId === undefined ? { status: 'not-found' as const } : { status: 'linked' as const, placeId }
  }
}

const identity = { providerKey: 'naver', externalPlaceId: 'naver-42' }

function attempt(command: CanonicalResolutionAttempt['command'], decisionId: string) {
  return applyCanonicalResolution({
    decisionId,
    sourceDecisionId: decisionId,
    command,
    policyVersion: 'canonical-resolution-v1',
    occurredAt: '2026-08-26T02:00:00.000Z',
    store,
  })
}

let store: MemoryCanonicalResolutionStore

describe('canonical Place resolution', () => {
  it('creates a provider-neutral Place and links its provider identity idempotently', async () => {
    store = new MemoryCanonicalResolutionStore()
    const command = { kind: 'create-place' as const, placeId: 'place-a', providerIdentity: identity }
    await expect(attempt(command, 'decision-create-a')).resolves.toEqual({ status: 'applied' })
    await expect(attempt(command, 'decision-create-a')).resolves.toEqual({ status: 'replayed' })
  })

  it('keeps an old reference traceable after a merge', async () => {
    store = new MemoryCanonicalResolutionStore()
    await attempt({ kind: 'create-place', placeId: 'place-a', providerIdentity: identity }, 'create-a')
    await attempt({
      kind: 'create-place',
      placeId: 'place-b',
      providerIdentity: { providerKey: 'google', externalPlaceId: 'google-99' },
    }, 'create-b')
    await expect(attempt({
      kind: 'merge-places', sourcePlaceId: 'place-a', targetPlaceId: 'place-b',
    }, 'merge-a-b')).resolves.toEqual({ status: 'applied' })

    await expect(store.resolve('place-a')).resolves.toEqual({
      status: 'active', placeId: 'place-b', redirectedFrom: ['place-a'],
    })
    await attempt({ kind: 'retire-place', placeId: 'place-b' }, 'retire-b')
    await expect(store.resolve('place-a')).resolves.toEqual({
      status: 'retired', placeId: 'place-b', redirectedFrom: ['place-a'],
    })
  })

  it('splits one provider identity without changing the source Place reference', async () => {
    store = new MemoryCanonicalResolutionStore()
    await attempt({ kind: 'create-place', placeId: 'place-a', providerIdentity: identity }, 'create-a')
    await expect(attempt({
      kind: 'split-provider-identity',
      sourcePlaceId: 'place-a',
      newPlaceId: 'place-b',
      providerIdentity: identity,
    }, 'split-a-b')).resolves.toEqual({ status: 'applied' })
    await expect(store.resolve('place-a')).resolves.toEqual({
      status: 'active', placeId: 'place-a', redirectedFrom: [],
    })
    await expect(store.resolveProviderIdentity(identity)).resolves.toEqual({
      status: 'linked', placeId: 'place-b',
    })
  })

  it('rejects self-merge and conflicting decision re-use', async () => {
    store = new MemoryCanonicalResolutionStore()
    await expect(attempt({
      kind: 'merge-places', sourcePlaceId: 'place-a', targetPlaceId: 'place-a',
    }, 'bad-merge')).rejects.toMatchObject({ name: 'InvalidCanonicalResolutionError' })

    await attempt({ kind: 'create-place', placeId: 'place-a', providerIdentity: identity }, 'decision-1')
    await expect(attempt({ kind: 'retire-place', placeId: 'place-a' }, 'decision-1'))
      .rejects.toMatchObject({ name: 'CanonicalResolutionConflictError' })
  })
})

import { describe, expect, it } from 'vitest'

import { createCanonicalPlaceKnowledge } from '../application/catalog-canonical-place-knowledge.js'
import type {
  CanonicalAssertionAppendAttempt,
  CanonicalAssertionAppendStoreResult,
  CanonicalPlaceKnowledgeStore,
  CanonicalProfilePublishAttempt,
} from '../application/ports/catalog-place-knowledge-store.js'
import type {
  CanonicalCurrentProfile,
  CanonicalFact,
  CanonicalFactAssertionBatch,
  CanonicalKnowledgeSubject,
  CanonicalPlaceProfileContent,
  CanonicalProfilePublishResult,
  CanonicalProfileReadResult,
} from '../domain/catalog-place-knowledge.js'
const assertionId = '01992d20-3000-7000-8000-000000000001'
const secondAssertionId = '01992d20-3000-7000-8000-000000000002'
const observationId = '01992d20-3000-7000-8000-000000000003'
const batchId = '01992d20-3000-7000-8000-000000000004'
const placeId = '01992d20-3000-7000-8000-000000000005'
const commandId = '01992d20-3000-7000-8000-000000000006'
const recordedAt = '2026-09-03T10:00:00+09:00'
const writeContext = {
  actor: { kind: 'policy', reference: 'catalog-resolution-policy.v2' },
} as const

const profile: CanonicalPlaceProfileContent = {
  displayName: {
    value: { text: '곳곳간 라멘 연구소', languageTag: 'ko' },
    sourceAssertionId: assertionId,
  },
  formattedAddress: null,
  location: null,
  operationalStatus: null,
  phone: null,
  website: null,
  openingHours: null,
  taxonomyAssignments: [{
    key: 'food.ramen.shoyu',
    version: 3,
    role: 'secondary',
    sourceAssertionId: assertionId,
  }],
  areaAssignments: [{
    key: 'kr.seoul.seongdong',
    version: 2,
    role: 'ancestor',
    sourceAssertionId: assertionId,
  }],
  media: [{
    mediaReferenceId: '01992d20-3000-7000-8000-000000000099',
    sourceAssertionId: secondAssertionId,
  }],
}

class RecordingStore implements CanonicalPlaceKnowledgeStore {
  appendAttempt?: CanonicalAssertionAppendAttempt
  publishAttempt?: CanonicalProfilePublishAttempt
  appendResult?: CanonicalAssertionAppendStoreResult
  publishResult?: CanonicalProfilePublishResult
  readResult?: Exclude<CanonicalProfileReadResult, Readonly<{ status: 'invalid' }>>

  async appendAssertions(attempt: CanonicalAssertionAppendAttempt) {
    this.appendAttempt = attempt
    return this.appendResult ?? {
      outcome: 'accepted' as const,
      batchId: attempt.batchId,
      status: 'recorded' as const,
      fingerprint: attempt.fingerprint,
      assertionIds: attempt.assertions.map(({ assertionId: id }) => id),
    }
  }

  async publishProfile(attempt: CanonicalProfilePublishAttempt) {
    this.publishAttempt = attempt
    if (this.publishResult !== undefined) return this.publishResult
    const currentProfile: CanonicalCurrentProfile = {
      schemaVersion: 'catalog-current-profile.v1',
      placeId: attempt.placeId,
      identityState: 'active',
      revision: 1,
      policyVersion: attempt.policyVersion,
      publishedAt: recordedAt,
      evidenceAssertionIds: attempt.evidenceAssertionIds,
      profile: attempt.profile,
    }
    return {
      schemaVersion: 'catalog-publish-profile-result.v1' as const,
      outcome: 'accepted' as const,
      commandId: attempt.commandId,
      status: 'applied' as const,
      currentProfile,
    }
  }

  async readCurrentProfile(place: string) {
    return this.readResult ?? { status: 'not-found' as const, placeId: place }
  }
}

function batch(
  facts: readonly CanonicalFact[],
  subject: CanonicalKnowledgeSubject = {
    kind: 'provider-identity',
    providerKey: 'naver',
    externalPlaceId: 'naver-place-1',
  },
): CanonicalFactAssertionBatch {
  return {
    schemaVersion: 'catalog-fact-assertion-batch.v1',
    batchId,
    recordedAt,
    assertions: facts.map((fact, index) => ({
      assertionId: `01992d20-3000-7000-8000-${String(index + 10).padStart(12, '0')}`,
      subject,
      fact,
      sourceObservationId: observationId,
      observedAt: recordedAt,
      confidence: 0.95,
      rightsProfileKey: 'provider.standard.v1',
    })),
  }
}

describe('contract-aligned CanonicalPlaceKnowledge', () => {
  it('accepts every contract fact shape for one provider identity observation', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const facts: readonly CanonicalFact[] = [
      { kind: 'name', value: { text: '라멘 연구소', languageTag: 'ko' } },
      { kind: 'formatted-address', value: { text: '서울 성동구 성수동', languageTag: 'ko' } },
      { kind: 'location', value: { latitude: 37.544, longitude: 127.056 } },
      { kind: 'operational-status', value: { status: 'operating' } },
      { kind: 'phone', value: { display: '02-123-4567', e164: '+8221234567' } },
      { kind: 'website', value: { uri: 'https://example.com/place' } },
      { kind: 'opening-hours', value: {
        timeZone: 'Asia/Seoul',
        weeklyPeriods: [{
          opens: { dayOfWeek: 'monday', localTime: '11:00' },
          closes: { dayOfWeek: 'monday', localTime: '21:00' },
        }],
      } },
      { kind: 'taxonomy', value: { key: 'food.ramen.shoyu', version: 3, role: 'attribute' } },
      { kind: 'area', value: { key: 'kr.seoul.seongdong', version: 2, role: 'alternate' } },
      { kind: 'media', value: {
        externalUri: 'https://provider.example.com/photos/source-1.jpg',
        size: { width: 1_200, height: 800 },
        rightsState: 'attribution-required',
        requiredAttributions: [{ label: 'Example Maps', uri: 'https://example.com' }],
      } },
    ]

    const result = await knowledge.assertFacts(batch(facts), writeContext)

    expect(result).toMatchObject({ outcome: 'accepted', batchId, status: 'recorded' })
    expect(store.appendAttempt?.fingerprint).toHaveLength(64)
    expect(store.appendAttempt?.assertions[0]?.subject.kind).toBe('provider-identity')
    expect(store.appendAttempt?.actor).toEqual(writeContext.actor)
  })

  it('accepts a separate assertion batch for a canonical Place subject', async () => {
    const store = new RecordingStore()
    const result = await createCanonicalPlaceKnowledge(store).assertFacts(batch(
      [{ kind: 'name', value: { text: '곳곳간 라멘 연구소', languageTag: 'ko' } }],
      { kind: 'canonical-place', placeId },
    ), writeContext)

    expect(result).toMatchObject({ outcome: 'accepted', status: 'recorded' })
    expect(store.appendAttempt?.assertions[0]?.subject).toEqual({
      kind: 'canonical-place',
      placeId,
    })
  })

  it('rejects assertions that do not share one observation context', async () => {
    const store = new RecordingStore()
    const input = batch([
      { kind: 'name', value: { text: '라멘 연구소' } },
      { kind: 'formatted-address', value: { text: '서울 성동구 성수동' } },
    ])
    const result = await createCanonicalPlaceKnowledge(store).assertFacts({
      ...input,
      assertions: [input.assertions[0]!, {
        ...input.assertions[1]!,
        subject: { kind: 'canonical-place', placeId },
        sourceObservationId: '01992d20-3000-7000-8000-000000000011',
        observedAt: '2026-09-03T11:00:00+09:00',
        rightsProfileKey: 'provider.restricted.v1',
      }],
    }, writeContext)

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invalid-assertions' },
    })
    if (result.outcome === 'rejected' && result.rejection.code === 'invalid-assertions') {
      expect(result.rejection.issues).toEqual(expect.arrayContaining([
        { path: 'assertions.1.subject', code: 'invalid-format' },
        { path: 'assertions.1.sourceObservationId', code: 'invalid-format' },
        { path: 'assertions.1.observedAt', code: 'invalid-format' },
        { path: 'assertions.1.rightsProfileKey', code: 'invalid-format' },
      ]))
    }
    expect(store.appendAttempt).toBeUndefined()
  })

  it('enforces audited assertion bounds before persistence', async () => {
    const store = new RecordingStore()
    const input = batch([
      { kind: 'name', value: { text: '라멘 연구소', languageTag: 'ko_KR' } },
      { kind: 'website', value: { uri: 'https://user:secret@example.com/place' } },
      {
        kind: 'taxonomy',
        value: { key: 'food.ramen', version: 2_147_483_648, role: 'primary' },
      },
    ])
    const result = await createCanonicalPlaceKnowledge(store).assertFacts({
      ...input,
      assertions: input.assertions.map((assertion, index) => ({
        ...assertion,
        observedAt: '2026-09-03T10:00:01+09:00',
        confidence: index === 0 ? 0.1234 : assertion.confidence,
        rightsProfileKey: 'provider.standard',
      })),
    }, writeContext)

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invalid-assertions' },
    })
    if (result.outcome === 'rejected' && result.rejection.code === 'invalid-assertions') {
      expect(result.rejection.issues).toEqual(expect.arrayContaining([
        { path: 'assertions.0.fact.value.languageTag', code: 'invalid-format' },
        { path: 'assertions.0.confidence', code: 'out-of-range' },
        { path: 'assertions.0.rightsProfileKey', code: 'invalid-format' },
        { path: 'recordedAt', code: 'out-of-range' },
        { path: 'assertions.1.fact.value.uri', code: 'invalid-format' },
        { path: 'assertions.2.fact.value.version', code: 'out-of-range' },
      ]))
    }
    expect(store.appendAttempt).toBeUndefined()
  })

  it('rejects raw batch fields, duplicate UUIDs, and identity retirement as an operational status', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const input = batch([{ kind: 'operational-status', value: { status: 'retired' as never } }])
    const result = await knowledge.assertFacts({
      ...input,
      providerRawPayload: { name: 'must not cross the seam' },
      assertions: [input.assertions[0]!, input.assertions[0]!],
    } as CanonicalFactAssertionBatch, writeContext)

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invalid-assertions' },
    })
    if (result.outcome === 'rejected' && result.rejection.code === 'invalid-assertions') {
      expect(result.rejection.issues).toEqual(expect.arrayContaining([
        { path: 'providerRawPayload', code: 'unexpected' },
        { path: 'assertions', code: 'duplicate' },
        { path: 'assertions.0.fact.value.status', code: 'invalid-format' },
      ]))
    }
    expect(store.appendAttempt).toBeUndefined()
  })

  it('requires a validated trusted actor and never reads it from the Catalog payload', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const invalidContext = {
      actor: { kind: 'member', reference: ' untrusted actor ' },
    } as never
    const assertionResult = await knowledge.assertFacts(
      batch([{ kind: 'name', value: { text: '라멘 연구소' } }]),
      invalidContext,
    )

    expect(assertionResult).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invalid-assertions' },
    })
    if (assertionResult.outcome === 'rejected' &&
      assertionResult.rejection.code === 'invalid-assertions') {
      expect(assertionResult.rejection.issues).toEqual(expect.arrayContaining([
        { path: 'context.actor.kind', code: 'invalid-format' },
        { path: 'context.actor.reference', code: 'invalid-format' },
      ]))
    }
    expect(store.appendAttempt).toBeUndefined()

    await expect(knowledge.publishProfile({
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Reviewed.',
      evidenceAssertionIds: [assertionId, secondAssertionId],
      profile,
    }, invalidContext)).rejects.toMatchObject({
      name: 'InvalidCanonicalPlaceKnowledgeInputError',
      issues: expect.arrayContaining([
        { path: 'context.actor.kind', code: 'invalid-format' },
      ]),
    })
    expect(store.publishAttempt).toBeUndefined()
  })

  it('produces a stable fingerprint and returns the store command-reuse rejection', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const input = batch([{ kind: 'name', value: { text: '라멘 연구소' } }])

    await knowledge.assertFacts(input, writeContext)
    const firstFingerprint = store.appendAttempt?.fingerprint
    await knowledge.assertFacts(input, writeContext)
    expect(store.appendAttempt?.fingerprint).toBe(firstFingerprint)

    store.appendResult = {
      outcome: 'rejected',
      batchId,
      rejection: { code: 'batch-id-reused' },
    }
    await expect(knowledge.assertFacts({
      ...input,
      assertions: [{
        ...input.assertions[0]!,
        fact: { kind: 'name', value: { text: '변경된 이름' } },
      }],
    }, writeContext)).resolves.toEqual({
      outcome: 'rejected',
      batchId,
      rejection: { code: 'batch-id-reused' },
    })
    expect(store.appendAttempt?.fingerprint).not.toBe(firstFingerprint)
  })

  it('publishes the exact optimistic command and accepted current profile shape', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const result = await knowledge.publishProfile({
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Provider assertions agree after duplicate review.',
      evidenceAssertionIds: [assertionId, secondAssertionId],
      profile,
    }, writeContext)

    expect(store.publishAttempt).toMatchObject({
      commandId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      actor: writeContext.actor,
    })
    expect(result).toMatchObject({
      schemaVersion: 'catalog-publish-profile-result.v1',
      outcome: 'accepted',
      status: 'applied',
      currentProfile: {
        identityState: 'active',
        policyVersion: 'catalog-policy.v2',
        publishedAt: recordedAt,
      },
    })
  })

  it('canonicalizes evidence set order for the operation fingerprint and Store attempt', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const reversedEvidence = [secondAssertionId, assertionId]
    const command = {
      schemaVersion: 'catalog-publish-profile-command.v1' as const,
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Reviewed.',
      evidenceAssertionIds: reversedEvidence,
      profile,
    }

    await knowledge.publishProfile(command, writeContext)
    const firstFingerprint = store.publishAttempt?.fingerprint
    expect(store.publishAttempt?.evidenceAssertionIds).toEqual([assertionId, secondAssertionId])
    expect(reversedEvidence).toEqual([secondAssertionId, assertionId])

    await knowledge.publishProfile({
      ...command,
      evidenceAssertionIds: [assertionId, secondAssertionId],
    }, writeContext)
    expect(store.publishAttempt?.fingerprint).toBe(firstFingerprint)
    expect(store.publishAttempt?.evidenceAssertionIds).toEqual([assertionId, secondAssertionId])

    await knowledge.publishProfile(command, {
      actor: { kind: 'reviewer', reference: 'reviewer:catalog-operator-1' },
    })
    expect(store.publishAttempt?.fingerprint).not.toBe(firstFingerprint)
  })

  it('rejects profile source assertions absent from command evidence', async () => {
    const knowledge = createCanonicalPlaceKnowledge(new RecordingStore())
    await expect(knowledge.publishProfile({
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Reviewed.',
      evidenceAssertionIds: [assertionId],
      profile,
    }, writeContext)).rejects.toMatchObject({
      name: 'InvalidCanonicalPlaceKnowledgeInputError',
      issues: expect.arrayContaining([{ path: 'profile', code: 'evidence-missing' }]),
    })
  })

  it('preserves the contract revision-conflict rejection', async () => {
    const store = new RecordingStore()
    store.publishResult = {
      schemaVersion: 'catalog-publish-profile-result.v1',
      outcome: 'rejected',
      commandId,
      rejection: { code: 'revision-conflict', currentRevision: 3 },
    }
    const result = await createCanonicalPlaceKnowledge(store).publishProfile({
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: 2,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Reviewed.',
      evidenceAssertionIds: [assertionId, secondAssertionId],
      profile,
    }, writeContext)

    expect(result).toEqual(store.publishResult)
    expect(store.publishAttempt?.expectedRevision).toBe(2)
  })

  it('rejects invalid assignment roles and unsafe media assertions before persistence', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const result = await knowledge.assertFacts(batch([
      {
        kind: 'taxonomy',
        value: { key: 'food.ramen', version: 1, role: 'ancestor' as never },
      },
      {
        kind: 'area',
        value: { key: 'kr.seoul', version: 1, role: 'secondary' as never },
      },
      {
        kind: 'media',
        value: {
          externalUri: 'https://provider.example.com/photos/source-1.jpg',
          rightsState: 'attribution-required',
          requiredAttributions: [],
        },
      },
    ]), writeContext)

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invalid-assertions' },
    })
    if (result.outcome === 'rejected' && result.rejection.code === 'invalid-assertions') {
      expect(result.rejection.issues).toEqual(expect.arrayContaining([
        { path: 'assertions.0.fact.value.role', code: 'invalid-format' },
        { path: 'assertions.1.fact.value.role', code: 'invalid-format' },
        { path: 'assertions.2.fact.value.requiredAttributions', code: 'required' },
      ]))
    }
    expect(store.appendAttempt).toBeUndefined()
  })

  it('keeps assertion-only and delivery-only fields outside published profile references', async () => {
    const store = new RecordingStore()
    const knowledge = createCanonicalPlaceKnowledge(store)
    const assertionResult = await knowledge.assertFacts(batch([{
      kind: 'taxonomy',
      value: {
        key: 'food.ramen',
        version: 1,
        role: 'primary',
        sourceAssertionId: assertionId,
      } as never,
    }]), writeContext)

    expect(assertionResult).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invalid-assertions' },
    })
    if (assertionResult.outcome === 'rejected' &&
      assertionResult.rejection.code === 'invalid-assertions') {
      expect(assertionResult.rejection.issues).toContainEqual({
        path: 'assertions.0.fact.value.sourceAssertionId',
        code: 'unexpected',
      })
    }

    await expect(knowledge.publishProfile({
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Reviewed.',
      evidenceAssertionIds: [assertionId, secondAssertionId],
      profile: {
        ...profile,
        displayName: { value: profile.displayName.value },
        taxonomyAssignments: [{
          key: 'food.ramen',
          version: 1,
          role: 'primary',
        }],
        areaAssignments: [{
          key: 'kr.seoul',
          version: 1,
          role: 'primary',
        }],
        media: [{
          mediaReferenceId: profile.media[0]!.mediaReferenceId,
          displayUri: 'https://cdn.example.com/photos/display-1.jpg',
        }],
      } as unknown as CanonicalPlaceProfileContent,
    }, writeContext)).rejects.toMatchObject({
      name: 'InvalidCanonicalPlaceKnowledgeInputError',
      issues: expect.arrayContaining([
        { path: 'profile.displayName.sourceAssertionId', code: 'required' },
        { path: 'profile.taxonomyAssignments.0.sourceAssertionId', code: 'required' },
        { path: 'profile.areaAssignments.0.sourceAssertionId', code: 'required' },
        { path: 'profile.media.0.sourceAssertionId', code: 'required' },
        { path: 'profile.media.0.displayUri', code: 'unexpected' },
      ]),
    })
  })

  it('rejects duplicate or ambiguous Profile collections and more than 32 media references', async () => {
    const store = new RecordingStore()
    const media = Array.from({ length: 33 }, (_, index) => ({
      mediaReferenceId: index === 32
        ? '01992d20-3000-7000-8000-000000000100'
        : `01992d20-3000-7000-8000-${String(index + 100).padStart(12, '0')}`,
      sourceAssertionId: assertionId,
    }))

    await expect(createCanonicalPlaceKnowledge(store).publishProfile({
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Reviewed.',
      evidenceAssertionIds: [assertionId],
      profile: {
        ...profile,
        taxonomyAssignments: [
          { key: 'food.ramen', version: 1, role: 'primary', sourceAssertionId: assertionId },
          { key: 'food.ramen', version: 1, role: 'primary', sourceAssertionId: assertionId },
        ],
        areaAssignments: [
          { key: 'kr.seoul', version: 1, role: 'primary', sourceAssertionId: assertionId },
          { key: 'kr.seoul', version: 1, role: 'primary', sourceAssertionId: assertionId },
        ],
        media,
      },
    }, writeContext)).rejects.toMatchObject({
      name: 'InvalidCanonicalPlaceKnowledgeInputError',
      issues: expect.arrayContaining([
        { path: 'profile.taxonomyAssignments', code: 'duplicate' },
        { path: 'profile.taxonomyAssignments', code: 'too-many' },
        { path: 'profile.areaAssignments', code: 'duplicate' },
        { path: 'profile.areaAssignments', code: 'too-many' },
        { path: 'profile.media', code: 'duplicate' },
        { path: 'profile.media', code: 'too-many' },
      ]),
    })
    expect(store.publishAttempt).toBeUndefined()
  })

  it('reads retired identity independently from operational status', async () => {
    const store = new RecordingStore()
    store.readResult = {
      status: 'available',
      currentProfile: {
        schemaVersion: 'catalog-current-profile.v1',
        placeId,
        identityState: 'retired',
        revision: 2,
        policyVersion: 'catalog-policy.v2',
        publishedAt: recordedAt,
        evidenceAssertionIds: [assertionId, secondAssertionId],
        profile: {
          ...profile,
          operationalStatus: {
            value: { status: 'permanently-closed' },
            sourceAssertionId: assertionId,
          },
        },
      },
    }

    await expect(createCanonicalPlaceKnowledge(store).readCurrentProfile(placeId))
      .resolves.toMatchObject({
        status: 'available',
        currentProfile: {
          identityState: 'retired',
          profile: { operationalStatus: { value: { status: 'permanently-closed' } } },
        },
      })
  })
})

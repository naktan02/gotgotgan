import { describe, expect, it } from 'vitest'

import {
  deterministicOperationId,
  planVersion,
  readOpaqueRevision,
  transferFingerprint,
} from '../application/identity.js'

describe('provider transfer identities', () => {
  it('fingerprints semantic objects independently of property order', () => {
    expect(transferFingerprint({ provider: 'naver', selection: { kind: 'all' } }))
      .toBe(transferFingerprint({ selection: { kind: 'all' }, provider: 'naver' }))
  })

  it('binds opaque revisions to both resource kind and identifier', () => {
    const planId = '01992d41-0000-7000-8000-000000000005'
    const revision = planVersion(planId, '7')

    expect(readOpaqueRevision('import-plan', revision, planId)).toBe('7')
    expect(readOpaqueRevision(
      'import-plan', revision, '01992d41-0000-7000-8000-000000000006',
    )).toBeUndefined()
    expect(readOpaqueRevision('outbound-transfer', revision, planId)).toBeUndefined()
  })

  it('derives stable, distinct operation identifiers for each source list', () => {
    const first = deterministicOperationId('import-plan', 'plan-1', 'list-1')
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(deterministicOperationId('import-plan', 'plan-1', 'list-1')).toBe(first)
    expect(deterministicOperationId('import-plan', 'plan-1', 'list-2')).not.toBe(first)
  })
})

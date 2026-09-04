import { describe, expect, it } from 'vitest'

import {
  connectorExportGrantSchema,
  validateConnectorExportGrantClaims,
} from '../outbound-export/index.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const transferId = '22222222-2222-4222-8222-222222222222'
const connectionId = '33333333-3333-4333-8333-333333333333'
const installationId = '44444444-4444-4444-8444-444444444444'
const accountFingerprint = 'c'.repeat(64)
const planDigest = 'a'.repeat(64)
const manifest = {
  schemaVersion: 'outbound-execution-manifest.v2',
  operationId,
  transferId,
  connectionId,
  providerKey: 'naver',
  accountFingerprint,
  collectionId: '99999999-9999-4999-8999-999999999999',
  collectionRevision: 'collection-r1',
  targetObservationRevision: 'target-r1',
  target: { kind: 'existing-list', targetListId: 'target-list-a' },
  planDigest,
  items: [{
    itemKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    placeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    targetProviderPlaceId: 'provider-place-a',
    action: 'add',
    sourcePosition: 0,
  }],
} as const
const grant = {
  schemaVersion: 'outbound-execution-grant.v2',
  grantId: '55555555-5555-4555-8555-555555555555',
  operationId,
  transferId,
  connectionId,
  providerKey: 'naver',
  accountFingerprint,
  installationId,
  operation: 'export-saved-library',
  planDigest,
  token: 't'.repeat(32),
  placeOrigin: 'https://place.example',
  issuedAt: '2026-09-03T00:00:00.000Z',
  expiresAt: '2026-09-03T00:05:00.000Z',
  limits: { maximumItems: 100, maximumBytes: 10_000, maximumBatches: 10 },
  manifest,
} as const
const use = {
  operationId,
  transferId,
  connectionId,
  providerKey: 'naver',
  accountFingerprint,
  installationId,
  operation: 'export-saved-library',
  planDigest,
  sourceOrigin: 'https://place.example',
  itemCount: 100,
  byteCount: 10_000,
  batchCount: 10,
  now: '2026-09-03T00:01:00.000Z',
} as const

describe('Connector export operation grant', () => {
  it('accepts only the exact Provider, operation, plan digest, origin, lifetime, and limits', () => {
    expect(validateConnectorExportGrantClaims({ grant, use })).toMatchObject({
      status: 'claims-valid',
    })

    for (const changedUse of [
      { ...use, operationId: '22222222-2222-4222-8222-222222222222' },
      { ...use, transferId: '66666666-6666-4666-8666-666666666666' },
      { ...use, connectionId: '77777777-7777-4777-8777-777777777777' },
      { ...use, providerKey: 'google' },
      { ...use, accountFingerprint: 'd'.repeat(64) },
      { ...use, installationId: '88888888-8888-4888-8888-888888888888' },
      { ...use, planDigest: 'b'.repeat(64) },
      { ...use, sourceOrigin: 'https://other.example' },
    ]) {
      expect(validateConnectorExportGrantClaims({ grant, use: changedUse })).toEqual({
        status: 'claims-invalid', reason: 'binding-mismatch',
      })
    }
  })

  it('rejects grants outside their lifetime and any aggregate overrun', () => {
    expect(validateConnectorExportGrantClaims({
      grant, use: { ...use, now: '2026-09-02T23:59:59.999Z' },
    })).toEqual({ status: 'claims-invalid', reason: 'not-yet-valid' })
    expect(validateConnectorExportGrantClaims({
      grant, use: { ...use, now: grant.expiresAt },
    })).toEqual({ status: 'claims-invalid', reason: 'expired' })

    for (const changedUse of [
      { ...use, itemCount: grant.limits.maximumItems + 1 },
      { ...use, byteCount: grant.limits.maximumBytes + 1 },
      { ...use, batchCount: grant.limits.maximumBatches + 1 },
    ]) {
      expect(validateConnectorExportGrantClaims({ grant, use: changedUse })).toEqual({
        status: 'claims-invalid', reason: 'limit-exceeded',
      })
    }
  })

  it('rejects non-exact or credential-bearing public origins and malformed grants', () => {
    for (const placeOrigin of [
      'http://place.example',
      'https://user:secret@place.example',
      'https://place.example/path',
    ]) {
      expect(connectorExportGrantSchema.safeParse({ ...grant, placeOrigin }).success).toBe(false)
    }
    expect(connectorExportGrantSchema.safeParse({
      ...grant, expiresAt: grant.issuedAt,
    }).success).toBe(false)
    expect(connectorExportGrantSchema.safeParse({ ...grant, token: 'short' }).success).toBe(false)
  })
})

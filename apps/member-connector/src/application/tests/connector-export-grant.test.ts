import { describe, expect, it } from 'vitest'

import {
  connectorExportGrantSchema,
  validateConnectorExportGrantClaims,
} from '../connector-export-grant.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const planDigest = 'a'.repeat(64)
const grant = {
  schemaVersion: 'place-connector-export-grant.v1',
  operationId,
  providerKey: 'naver',
  operation: 'export-saved-library',
  planDigest,
  token: 't'.repeat(32),
  placeOrigin: 'https://place.example',
  issuedAt: '2026-09-03T00:00:00.000Z',
  expiresAt: '2026-09-03T00:05:00.000Z',
  limits: { maximumItems: 100, maximumBytes: 10_000, maximumBatches: 10 },
} as const
const use = {
  operationId,
  providerKey: 'naver',
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
      { ...use, providerKey: 'google' },
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

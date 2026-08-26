import { describe, expect, it } from 'vitest'

import {
  connectorCaptureBatchSchema,
  connectorCaptureReceiptSchema,
  connectorExtensionEventSchema,
  connectorGrantSchema,
  connectorPageCommandSchema,
} from '../src/connector/index.js'

const operationId = '01992d20-7000-7000-8000-000000000011'
const requestId = '01992d20-7000-7000-8000-000000000012'
const installationId = '01992d20-7000-7000-8000-000000000013'

function grant(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'place-connector-grant.v1',
    operationId,
    providerKey: 'naver',
    operation: 'import-saved-library',
    idempotencyKey: requestId,
    token: 'opaque.connector.grant.token.that.is.long.enough',
    placeOrigin: 'https://place.example',
    expiresAt: '2026-08-26T12:00:00.000Z',
    limits: {
      maximumItems: 5_000,
      maximumBytes: 8_388_608,
      maximumBatches: 20,
      maximumBatchBytes: 1_048_576,
    },
    ...overrides,
  }
}

describe('Place Connector v1 contract', () => {
  it('binds a grant to one operation, provider, exact public origin, and bounded transfer', () => {
    expect(connectorGrantSchema.parse(grant()).providerKey).toBe('naver')
    expect(connectorGrantSchema.safeParse(grant({
      placeOrigin: 'https://place.example/private/backend?target=https://arbitrary.example',
    })).success).toBe(false)
    expect(connectorGrantSchema.safeParse(grant({
      placeOrigin: 'http://place.example',
    })).success).toBe(false)
    expect(connectorGrantSchema.safeParse(grant({
      limits: {
        maximumItems: 5_000,
        maximumBytes: 1_024,
        maximumBatches: 20,
        maximumBatchBytes: 2_048,
      },
    })).success).toBe(false)
  })

  it('accepts Whale as an explicit Chromium delivery target without accepting credentials', () => {
    expect(connectorExtensionEventSchema.parse({
      schemaVersion: 'place-connector-event.v1',
      channel: 'place-connector',
      requestId,
      kind: 'ready',
      installationId,
      browserKey: 'whale',
      supportedProviders: ['naver'],
    }).browserKey).toBe('whale')

    expect(connectorPageCommandSchema.safeParse({
      schemaVersion: 'place-connector-command.v1',
      channel: 'place-connector',
      requestId,
      kind: 'start-import',
      grant: grant(),
      providerPassword: 'not-allowed',
      cookie: 'not-allowed',
      uploadUrl: 'https://arbitrary.example',
    }).success).toBe(false)
  })

  it('requires ordered bounded capture batches with a body checksum', () => {
    expect(connectorCaptureBatchSchema.parse({
      schemaVersion: 'place-connector-capture-batch.v1',
      operationId,
      providerKey: 'naver',
      sequence: 0,
      final: true,
      itemCount: 1,
      contentType: 'application/json',
      payload: '{"items":[]}',
      checksum: 'a'.repeat(64),
    }).final).toBe(true)

    expect(connectorCaptureBatchSchema.safeParse({
      schemaVersion: 'place-connector-capture-batch.v1',
      operationId,
      providerKey: 'naver',
      sequence: 0,
      final: true,
      itemCount: 1,
      contentType: 'application/json',
      payload: '{"items":[]}',
      checksum: 'not-a-checksum',
    }).success).toBe(false)

    expect(connectorCaptureReceiptSchema.safeParse({
      schemaVersion: 'place-connector-capture-receipt.v1',
      operationId,
      acceptedSequence: 0,
      acceptedChecksum: 'a'.repeat(64),
      receivedItems: 1,
      receivedBytes: 12,
      importBatchId: installationId,
    }).success).toBe(true)
  })
})

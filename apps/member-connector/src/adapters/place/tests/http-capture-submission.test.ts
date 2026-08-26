import type {
  ConnectorCaptureBatch,
  ConnectorGrant,
} from '@place/contracts/connector'
import { describe, expect, it, vi } from 'vitest'

import { HttpCaptureSubmission } from '../capture-upload/http-capture-submission.js'

const operationId = '01992d20-7000-7000-8000-000000000031'
const importBatchId = '01992d20-7000-7000-8000-000000000032'

const grant: ConnectorGrant = {
  schemaVersion: 'place-connector-grant.v1',
  operationId,
  providerKey: 'naver',
  operation: 'import-saved-library',
  idempotencyKey: '01992d20-7000-7000-8000-000000000033',
  token: 'opaque.connector.grant.token.that.is.long.enough',
  placeOrigin: 'https://place.example',
  expiresAt: '2026-08-26T12:00:00.000Z',
  limits: {
    maximumItems: 100,
    maximumBytes: 10_000,
    maximumBatches: 10,
    maximumBatchBytes: 5_000,
  },
}

const batch: ConnectorCaptureBatch = {
  schemaVersion: 'place-connector-capture-batch.v1',
  operationId,
  providerKey: 'naver',
  sequence: 0,
  final: true,
  itemCount: 0,
  contentType: 'application/json',
  payload: '{"items":[]}',
  checksum: 'a'.repeat(64),
}

describe('HttpCaptureSubmission', () => {
  it('uses only the fixed public BFF path and an operation grant without browser cookies', async () => {
    const fetch = vi.fn(async () => ({
      status: 202,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        schemaVersion: 'place-connector-capture-receipt.v1',
        operationId,
        acceptedSequence: 0,
        acceptedChecksum: batch.checksum,
        receivedItems: 0,
        receivedBytes: 12,
        importBatchId,
      }),
    }))
    const submission = new HttpCaptureSubmission(fetch)
    await expect(submission.submit({
      grant,
      batch,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ importBatchId })

    expect(fetch).toHaveBeenCalledWith(
      'https://place.example/api/connector/captures',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'manual',
        headers: expect.objectContaining({
          authorization: `PlaceConnector ${grant.token}`,
          'x-place-connector-operation': operationId,
        }),
      }),
    )
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('cookie')
  })

  it('classifies redirects as invalid connector requests', async () => {
    const redirect = new HttpCaptureSubmission(async () => ({
      status: 302,
      headers: { get: () => 'text/html' },
      text: async () => '',
    }))
    await expect(redirect.submit({
      grant,
      batch,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'CaptureSubmissionError', code: 'invalid-request', retryable: false,
    })
  })

  it('classifies a backend capture contract rejection as provider drift', async () => {
    const invalid = new HttpCaptureSubmission(async () => ({
      status: 400,
      headers: { get: () => 'application/problem+json' },
      text: async () => JSON.stringify({
        type: 'urn:place:error:connector-capture-invalid',
        title: 'Connector capture is invalid',
        status: 400,
        code: 'PLACE_CONNECTOR_CAPTURE_INVALID',
        retryable: false,
        correlationRef: '01992d20-7000-7000-8000-000000000034',
      }),
    }))

    await expect(invalid.submit({
      grant,
      batch,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'CaptureSubmissionError', code: 'provider-drift', retryable: false,
    })
  })

  it('classifies an invalid grant as an invalid connector request', async () => {
    const invalid = new HttpCaptureSubmission(async () => ({
      status: 401,
      headers: { get: () => 'application/problem+json' },
      text: async () => JSON.stringify({
        type: 'urn:place:error:connector-grant-invalid',
        title: 'Connector grant is invalid',
        status: 401,
        code: 'PLACE_CONNECTOR_GRANT_INVALID',
        retryable: false,
        correlationRef: '01992d20-7000-7000-8000-000000000035',
      }),
    }))

    await expect(invalid.submit({
      grant,
      batch,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'CaptureSubmissionError', code: 'invalid-request', retryable: false,
    })
  })

  it('classifies a browser network failure as an internal retryable failure', async () => {
    const unavailable = new HttpCaptureSubmission(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(unavailable.submit({
      grant,
      batch,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'CaptureSubmissionError', code: 'internal-failure', retryable: true,
    })
  })

  it.each([
    [404, 'text/html', 'not found', 'invalid-request', false],
    [503, 'text/html', 'unavailable', 'internal-failure', true],
    [413, 'text/html', 'too large', 'upload-rejected', false],
  ] as const)(
    'classifies an unstructured HTTP %i response without collapsing the failure boundary',
    async (status, contentType, body, code, retryable) => {
      const rejected = new HttpCaptureSubmission(async () => ({
        status,
        headers: { get: () => contentType },
        text: async () => body,
      }))

      await expect(rejected.submit({
        grant,
        batch,
        signal: new AbortController().signal,
      })).rejects.toMatchObject({
        name: 'CaptureSubmissionError', code, retryable,
      })
    },
  )
})

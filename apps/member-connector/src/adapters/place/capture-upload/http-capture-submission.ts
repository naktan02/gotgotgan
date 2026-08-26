import {
  connectorCaptureReceiptSchema,
  type ConnectorCaptureBatch,
  type ConnectorGrant,
} from '@place/contracts/connector'

import {
  CaptureSubmissionError,
  type CaptureSubmission,
} from '../../../application/ports/capture-submission.js'

type ResponseLike = Readonly<{
  status: number
  headers: Readonly<{ get(name: string): string | null }>
  text(): Promise<string>
}>

type FetchLike = (
  input: string,
  init: Readonly<{
    method: 'POST'
    headers: Readonly<Record<string, string>>
    body: string
    credentials: 'omit'
    redirect: 'manual'
    signal: AbortSignal
  }>,
) => Promise<ResponseLike>

const maximumReceiptBytes = 65_536

function problemDetails(value: unknown): Readonly<{ code: string; retryable: boolean }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Readonly<Record<string, unknown>>
  return typeof candidate.code === 'string' && typeof candidate.retryable === 'boolean'
    ? { code: candidate.code, retryable: candidate.retryable }
    : undefined
}

function submissionError(status: number, body: string): CaptureSubmissionError {
  let decoded: unknown
  try {
    decoded = JSON.parse(body)
  } catch {
    decoded = undefined
  }
  const problem = problemDetails(decoded)
  const code = problem?.code
  if (code === 'PLACE_CONNECTOR_CAPTURE_INVALID') {
    return new CaptureSubmissionError('provider-drift', false, 'Connector capture is invalid')
  }
  if (
    code === 'PLACE_CONNECTOR_REQUEST_INVALID' ||
    code === 'PLACE_CONNECTOR_CAPTURE_REQUEST_INVALID' ||
    code === 'PLACE_CONNECTOR_GRANT_INVALID' ||
    code === 'PLACE_CONNECTOR_ORIGIN_DENIED' ||
    code === 'PLACE_CONNECTOR_OPERATION_CONFLICT'
  ) return new CaptureSubmissionError('invalid-request', false, 'Connector capture request is invalid')
  if (code === 'PLACE_CONNECTOR_UNAVAILABLE') {
    return new CaptureSubmissionError(
      'internal-failure', true, 'Connector capture submission is unavailable',
    )
  }
  if (code === 'PLACE_CONNECTOR_LIMIT_EXCEEDED' || status === 413 || status === 429) {
    return new CaptureSubmissionError(
      'upload-rejected', status === 429, 'Connector capture exceeded the upload boundary',
    )
  }
  if (status >= 500) {
    return new CaptureSubmissionError(
      'internal-failure', true, 'Connector capture submission is unavailable',
    )
  }
  if (status >= 300 && status < 500) {
    return new CaptureSubmissionError(
      'invalid-request', false, 'Connector capture request was not accepted',
    )
  }
  return new CaptureSubmissionError(
    'upload-rejected',
    problem?.retryable ?? false,
    'Connector capture submission was rejected',
  )
}

export class HttpCaptureSubmission implements CaptureSubmission {
  constructor(private readonly fetch: FetchLike = globalThis.fetch as FetchLike) {}

  async submit(input: Readonly<{
    grant: ConnectorGrant
    batch: ConnectorCaptureBatch
    signal: AbortSignal
  }>) {
    if (
      input.batch.operationId !== input.grant.operationId ||
      input.batch.providerKey !== input.grant.providerKey
    ) throw new Error('Connector capture submission does not match its grant')

    const target = new URL('/api/connector/captures', input.grant.placeOrigin)
    if (target.origin !== input.grant.placeOrigin) {
      throw new Error('Connector capture submission origin is invalid')
    }
    let response: ResponseLike
    try {
      response = await this.fetch(target.toString(), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `PlaceConnector ${input.grant.token}`,
          'content-type': 'application/json',
          'x-place-connector-operation': input.grant.operationId,
        },
        body: JSON.stringify(input.batch),
        credentials: 'omit',
        redirect: 'manual',
        signal: input.signal,
      })
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason
      throw new CaptureSubmissionError(
        'internal-failure', true, 'Connector capture submission is unavailable',
      )
    }
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > maximumReceiptBytes) {
      throw new CaptureSubmissionError(
        'upload-rejected', false, 'Connector capture receipt is too large',
      )
    }
    if (
      response.status < 200 || response.status >= 300 ||
      !response.headers.get('content-type')?.toLowerCase().includes('json')
    ) {
      throw submissionError(response.status, body)
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(body)
    } catch {
      throw new CaptureSubmissionError(
        'upload-rejected', false, 'Connector capture receipt is invalid',
      )
    }
    const receipt = connectorCaptureReceiptSchema.safeParse(decoded)
    if (!receipt.success) {
      throw new CaptureSubmissionError(
        'upload-rejected', false, 'Connector capture receipt is invalid',
      )
    }
    return receipt.data
  }
}

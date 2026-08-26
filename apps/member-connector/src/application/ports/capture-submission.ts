import type {
  ConnectorCaptureBatch,
  ConnectorCaptureReceipt,
  ConnectorGrant,
  ConnectorResultCode,
} from '@place/contracts/connector'

export class CaptureSubmissionError extends Error {
  constructor(
    readonly code: Extract<
      ConnectorResultCode,
      'internal-failure' | 'invalid-request' | 'provider-drift' | 'upload-rejected'
    >,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'CaptureSubmissionError'
  }
}

export interface CaptureSubmission {
  submit(input: Readonly<{
    grant: ConnectorGrant
    batch: ConnectorCaptureBatch
    signal: AbortSignal
  }>): Promise<ConnectorCaptureReceipt>
}

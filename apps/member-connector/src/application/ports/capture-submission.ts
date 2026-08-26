import type {
  ConnectorCaptureBatch,
  ConnectorCaptureReceipt,
  ConnectorGrant,
} from '@place/contracts/connector'

export interface CaptureSubmission {
  submit(input: Readonly<{
    grant: ConnectorGrant
    batch: ConnectorCaptureBatch
    signal: AbortSignal
  }>): Promise<ConnectorCaptureReceipt>
}

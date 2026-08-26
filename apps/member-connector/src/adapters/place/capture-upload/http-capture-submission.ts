import {
  connectorCaptureReceiptSchema,
  type ConnectorCaptureBatch,
  type ConnectorGrant,
} from '@place/contracts/connector'

import type { CaptureSubmission } from '../../../application/ports/capture-submission.js'

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
    const response = await this.fetch(target.toString(), {
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
    if (
      response.status < 200 || response.status >= 300 ||
      !response.headers.get('content-type')?.toLowerCase().includes('json')
    ) throw new Error('Connector capture submission was rejected')

    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > maximumReceiptBytes) {
      throw new Error('Connector capture receipt is too large')
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(body)
    } catch {
      throw new Error('Connector capture receipt is invalid')
    }
    return connectorCaptureReceiptSchema.parse(decoded)
  }
}

export type AuthenticatedJsonClientFailure =
  | 'permission-denied'
  | 'response-too-large'
  | 'transport-unavailable'

export class AuthenticatedJsonClientError extends Error {
  constructor(
    readonly code: AuthenticatedJsonClientFailure,
    message: string,
  ) {
    super(message)
    this.name = 'AuthenticatedJsonClientError'
  }
}

export interface AuthenticatedJsonClient {
  get(input: Readonly<{
    url: URL
    maximumBytes: number
    signal: AbortSignal
  }>): Promise<Readonly<{
    status: number
    contentType: string
    body: Uint8Array
  }>>
}

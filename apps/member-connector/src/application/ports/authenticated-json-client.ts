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

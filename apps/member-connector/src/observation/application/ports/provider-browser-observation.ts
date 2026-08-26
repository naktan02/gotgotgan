export type ObservedBrowserResponse = Readonly<{
  method: string
  url: string
  status: number
  contentType: string
  body?: unknown
}>

export type BrowserObservationResult = Readonly<{
  startedAt: string
  finishedAt: string
  responses: readonly ObservedBrowserResponse[]
}>

export interface ProviderBrowserObservation {
  observe(input: Readonly<{
    targetUrl: string
    requestUrl?: string
    allowedOrigins: readonly string[]
    metadataHostSuffix: string
    maximumBodyBytes: number
    signal: AbortSignal
  }>): Promise<BrowserObservationResult>
}

import type { MemberConnectorObservationReport } from '../../observation/application/observe-provider-network.js'
import { observeProviderNetwork } from '../../observation/application/observe-provider-network.js'
import type { ProviderBrowserObservation } from '../../observation/application/ports/provider-browser-observation.js'
import type { MemberConnectorConfig } from './config.js'

type MemberBrowser = ProviderBrowserObservation & Readonly<{
  openLogin(input: Readonly<{
    targetUrl: string
    signal: AbortSignal
  }>): Promise<Readonly<{ status: 'closed' | 'cancelled' }>>
}>

type ObservationReportStore = Readonly<{
  write(input: Readonly<{
    reportId: string
    report: MemberConnectorObservationReport
  }>): Promise<Readonly<{ reportId: string }>>
}>

type MemberSavedPlaceCollector = Readonly<{
  collectAll(input: Readonly<{ signal: AbortSignal }>): Promise<Readonly<{
    lists: readonly unknown[]
    summary: Readonly<{
      listCount: number
      bookmarkCount: number
      requestCount: number
    }>
  }>>
}>

export function describeMemberConnector() {
  return {
    process: 'member-connector' as const,
    service: 'place' as const,
    state: 'source-only' as const,
    provider: 'naver' as const,
    capabilities: [
      'dedicated-profile-login' as const,
      'redacted-network-observation' as const,
      'full-saved-place-collection' as const,
    ],
    captureSubmission: 'not-integrated' as const,
    liveAcquisition: 'integration-gated' as const,
  }
}

export async function runMemberConnectorCommand(input: Readonly<{
  config: MemberConnectorConfig
  browser?: MemberBrowser
  collector?: MemberSavedPlaceCollector
  reportStore?: ObservationReportStore
  nextId: () => string
  signal: AbortSignal
}>) {
  if (input.config.command === 'login-naver') {
    if (input.browser === undefined) throw new Error('Member browser is unavailable')
    const result = await input.browser.openLogin({
      targetUrl: input.config.targetUrl,
      signal: input.signal,
    })
    return { operation: 'naver-login-window' as const, status: result.status }
  }
  if (input.config.command === 'collect-naver') {
    if (input.collector === undefined) throw new Error('Saved-place collector is unavailable')
    const result = await input.collector.collectAll({ signal: input.signal })
    return {
      operation: 'naver-saved-place-collection' as const,
      status: 'completed' as const,
      ...result.summary,
      captureSubmission: 'not-integrated' as const,
    }
  }
  if (input.browser === undefined) throw new Error('Member browser is unavailable')
  if (input.reportStore === undefined) throw new Error('Observation report store is unavailable')
  const report = await observeProviderNetwork({
    providerKey: input.config.providerKey,
    targetUrl: input.config.targetUrl,
    ...(input.config.requestUrl === undefined ? {} : { requestUrl: input.config.requestUrl }),
    allowedOrigins: input.config.allowedOrigins,
    maximumBodyBytes: input.config.maximumBodyBytes,
    browser: input.browser,
    signal: input.signal,
  })
  const reportId = input.nextId()
  await input.reportStore.write({ reportId, report })
  return {
    operation: 'naver-network-observation' as const,
    status: 'completed' as const,
    reportId,
    responseCount: report.responses.length,
  }
}

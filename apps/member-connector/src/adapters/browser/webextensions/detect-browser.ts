import type { ConnectorBrowserKey } from '@place/contracts/connector'

export function detectConnectorBrowser(userAgent: string): ConnectorBrowserKey {
  if (/Whale\//i.test(userAgent)) return 'whale'
  if (/Edg\//i.test(userAgent)) return 'edge'
  if (/Firefox\//i.test(userAgent)) return 'firefox'
  if (/Safari\//i.test(userAgent) && !/(?:Chrome|Chromium)\//i.test(userAgent)) return 'safari'
  if (/Chrome\//i.test(userAgent)) return 'chrome'
  if (/Chromium\//i.test(userAgent)) return 'chromium-other'
  return 'chromium-other'
}

import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

import { ConnectorCommandHandler } from '../../application/handle-connector-command.js'
import { collectSavedLibrary } from '../../application/collect-saved-library.js'
import { WebExtensionAuthenticatedJsonClient } from '../../adapters/browser/webextensions/authenticated-json-client.js'
import { detectConnectorBrowser } from '../../adapters/browser/webextensions/detect-browser.js'
import { WebExtensionInstallationStore } from '../../adapters/browser/webextensions/installation-store.js'
import { registerConnectorBackground } from '../../adapters/browser/webextensions/register-background.js'
import { HttpCaptureSubmission } from '../../adapters/place/capture-upload/http-capture-submission.js'
import {
  createNaverSavedPlaceCollector,
  NaverExtensionSavedPlaceSource,
  NaverProviderSession,
} from '../../adapters/providers/naver/naver-extension-saved-library.js'

export default defineBackground(() => {
  const installationStore = new WebExtensionInstallationStore(browser.storage.local)
  const naverClient = new WebExtensionAuthenticatedJsonClient(
    'https://pages.map.naver.com',
    {
      contains: (permission) => browser.permissions.contains(permission),
      request: (permission) => browser.permissions.request(permission),
    },
  )
  const naverDependencies = {
    session: new NaverProviderSession(naverClient),
    source: new NaverExtensionSavedPlaceSource(createNaverSavedPlaceCollector(), naverClient),
    submission: new HttpCaptureSubmission(),
  }
  const handler = new ConnectorCommandHandler({
    browserKey: detectConnectorBrowser(globalThis.navigator.userAgent),
    getInstallationId: async () => installationStore.getOrCreate(),
    prepareProviders: new Map([[
      'naver',
      async () => {
        await naverClient.prepare()
        return true
      },
    ]]),
    operations: new Map([[
      'naver',
      (input) => collectSavedLibrary(naverDependencies, input),
    ]]),
  })
  registerConnectorBackground(browser, handler)
})

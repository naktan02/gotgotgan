import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

import { ConnectorCommandHandler } from '../../application/handle-connector-command.js'
import { detectConnectorBrowser } from '../../adapters/browser/webextensions/detect-browser.js'
import { WebExtensionInstallationStore } from '../../adapters/browser/webextensions/installation-store.js'
import { registerConnectorBackground } from '../../adapters/browser/webextensions/register-background.js'

export default defineBackground(() => {
  const installationStore = new WebExtensionInstallationStore(browser.storage.local)
  const handler = new ConnectorCommandHandler({
    browserKey: detectConnectorBrowser(globalThis.navigator.userAgent),
    getInstallationId: async () => installationStore.getOrCreate(),
    operations: new Map(),
  })
  registerConnectorBackground(browser, handler)
})

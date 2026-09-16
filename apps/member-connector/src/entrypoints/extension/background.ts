import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

import { ConnectorCommandHandler } from '../../application/handle-connector-command.js'
import { detectConnectorBrowser } from '../../adapters/browser/webextensions/detect-browser.js'
import { WebExtensionInstallationStore } from '../../adapters/browser/webextensions/installation-store.js'
import { registerConnectorBackground } from '../../adapters/browser/webextensions/register-background.js'
import { createConfiguredConnectorTransferRuntime } from '../transfer-runtime-config.js'

export default defineBackground(() => {
  const installationStore = new WebExtensionInstallationStore(browser.storage.local)
  // The production v2 adapters are intentionally absent until encrypted local spools, a verified
  // account fingerprint source and public BFF routes are composed. An empty runtime is truthful and
  // must not fall back to the retired v1 capture receiver or an unverified Provider write adapter.
  const transferRuntime = createConfiguredConnectorTransferRuntime()
  if (
    transferRuntime.capabilities.importProviders.length > 0 ||
    transferRuntime.capabilities.exportProviders.length > 0
  ) throw new Error('Connector v2 page bridge must be composed before transfer capabilities')
  const handler = new ConnectorCommandHandler({
    browserKey: detectConnectorBrowser(globalThis.navigator.userAgent),
    getInstallationId: async () => installationStore.getOrCreate(),
    operations: new Map(),
  })
  registerConnectorBackground(browser, handler)
})

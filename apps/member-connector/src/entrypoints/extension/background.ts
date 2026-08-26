import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

import { ConnectorCommandHandler } from '../../application/handle-connector-command.js'
import { collectSavedLibrary } from '../../application/collect-saved-library.js'
import { detectConnectorBrowser } from '../../adapters/browser/webextensions/detect-browser.js'
import { WebExtensionInstallationStore } from '../../adapters/browser/webextensions/installation-store.js'
import { WebExtensionPageJsonRequest } from '../../adapters/browser/webextensions/page-json-request.js'
import { hasProviderOriginPermission } from '../../adapters/browser/webextensions/provider-origin-permissions.js'
import { WebExtensionProviderPageJsonClient } from '../../adapters/browser/webextensions/provider-page-json-client.js'
import { registerConnectorBackground } from '../../adapters/browser/webextensions/register-background.js'
import { HttpCaptureSubmission } from '../../adapters/place/capture-upload/http-capture-submission.js'
import {
  createNaverSavedPlaceCollector,
  NaverExtensionSavedPlaceSource,
  NaverProviderSession,
} from '../../adapters/providers/naver/naver-extension-saved-library.js'

export default defineBackground(() => {
  const installationStore = new WebExtensionInstallationStore(browser.storage.local)
  const placeOrigin = import.meta.env.WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN
  const placePageRequest = new WebExtensionPageJsonRequest(
    placeOrigin,
    { query: (query) => browser.tabs.query(query) },
    { executeScript: (details) => browser.scripting.executeScript(details) },
  )
  const naverClient = new WebExtensionProviderPageJsonClient(
    'https://pages.map.naver.com',
    'https://pages.map.naver.com/save-pages/pc/all-list',
    {
      contains: (permission) => browser.permissions.contains(permission),
      request: (permission) => browser.permissions.request(permission),
    },
    {
      query: (query) => browser.tabs.query(query),
      create: (properties) => browser.tabs.create(properties),
      get: (tabId) => browser.tabs.get(tabId),
    },
    {
      executeScript: (details) => browser.scripting.executeScript(details),
    },
  )
  const naverDependencies = {
    session: new NaverProviderSession(naverClient),
    source: new NaverExtensionSavedPlaceSource(createNaverSavedPlaceCollector(), naverClient),
    submission: new HttpCaptureSubmission(async (input, init) => {
      const response = await placePageRequest.request({
        url: input,
        method: init.method,
        headers: init.headers,
        body: init.body,
        credentials: init.credentials,
        redirect: init.redirect,
        maximumResponseBytes: 65_536,
        signal: init.signal,
      })
      return {
        status: response.status,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? response.contentType : null },
        text: async () => response.bodyText,
      }
    }),
  }
  const handler = new ConnectorCommandHandler({
    browserKey: detectConnectorBrowser(globalThis.navigator.userAgent),
    getInstallationId: async () => installationStore.getOrCreate(),
    prepareProviders: new Map([[
      'naver',
      async () => {
        if (await hasProviderOriginPermission(browser.permissions, 'naver')) return true
        await browser.tabs.create({
          active: true,
          url: new URL('popup.html?provider=naver', import.meta.url).toString(),
        })
        return false
      },
    ]]),
    reauthenticateProviders: new Map([[
      'naver',
      async () => {
        await browser.tabs.create({
          active: true,
          url: 'https://nid.naver.com/nidlogin.login',
        })
      },
    ]]),
    operations: new Map([[
      'naver',
      (input) => collectSavedLibrary(naverDependencies, input),
    ]]),
  })
  registerConnectorBackground(browser, handler)
})

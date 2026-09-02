import { randomUUID } from 'node:crypto'

import {
  defineBrowserAuthApplication,
  type BrowserAuthApplicationConfig,
} from './application-config.js'
import { createBrowserAuthHttp } from './browser-auth-http.js'
import {
  getOrCreateGlobalNextOidcLifecycle,
  type NextOidcLifecycleDependencies,
} from './next-oidc-lifecycle.js'
import { createOidcProcessRuntime } from './oidc-process-runtime.js'
import { createOpenidClientProvider } from './openid-client-provider.js'
import type { BrowserAuthEnvironment } from './oidc-runtime-config.js'

export type BrowserAuthApplicationDependencies = Readonly<{
  createProvider?: NextOidcLifecycleDependencies['createProvider']
  createRuntime?: NextOidcLifecycleDependencies['createRuntime']
  scheduleInterval?: NextOidcLifecycleDependencies['scheduleInterval']
  cancelInterval?: NextOidcLifecycleDependencies['cancelInterval']
  now?: NextOidcLifecycleDependencies['now']
  waitForRetry?: NextOidcLifecycleDependencies['waitForRetry']
  reportCleanupFailure?: NextOidcLifecycleDependencies['reportCleanupFailure']
  reportShutdownFailure?: NextOidcLifecycleDependencies['reportShutdownFailure']
  shutdownSignals?: NextOidcLifecycleDependencies['shutdownSignals']
  createCorrelationRef?: () => string
}>

export function createBrowserAuthApplication(
  input: BrowserAuthApplicationConfig,
  dependencies: BrowserAuthApplicationDependencies = {},
) {
  const application = defineBrowserAuthApplication(input)
  const lifecycle = getOrCreateGlobalNextOidcLifecycle({
    application,
    createProvider: dependencies.createProvider ?? createOpenidClientProvider,
    createRuntime: dependencies.createRuntime ?? createOidcProcessRuntime,
    ...(dependencies.scheduleInterval === undefined
      ? {}
      : { scheduleInterval: dependencies.scheduleInterval }),
    ...(dependencies.cancelInterval === undefined
      ? {}
      : { cancelInterval: dependencies.cancelInterval }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    ...(dependencies.waitForRetry === undefined
      ? {}
      : { waitForRetry: dependencies.waitForRetry }),
    ...(dependencies.reportCleanupFailure === undefined
      ? {}
      : { reportCleanupFailure: dependencies.reportCleanupFailure }),
    ...(dependencies.reportShutdownFailure === undefined
      ? {}
      : { reportShutdownFailure: dependencies.reportShutdownFailure }),
    ...(dependencies.shutdownSignals === undefined
      ? {}
      : { shutdownSignals: dependencies.shutdownSignals }),
  })
  const http = createBrowserAuthHttp({
    resolveRuntime: () => lifecycle.current(),
    createCorrelationRef: dependencies.createCorrelationRef ?? randomUUID,
  })

  return {
    application,
    install(
      environment: BrowserAuthEnvironment = process.env,
    ) {
      return lifecycle.install(environment)
    },
    current: () => lifecycle.current(),
    close: () => lifecycle.close(),
    http,
  }
}

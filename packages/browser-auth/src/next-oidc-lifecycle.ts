import {
  browserAuthEnvironmentName,
  type BrowserAuthApplicationConfig,
} from './application-config.js'
import type { ReadyOidcProvider } from './oidc-bff.js'
import {
  loadOidcProcessRuntimeConfig,
  type BrowserAuthEnvironment,
} from './oidc-runtime-config.js'
import type {
  OidcProcessRuntime,
  OidcProcessRuntimeConfig,
} from './oidc-process-runtime.js'

type IntervalHandle = Readonly<{
  unref?: () => void
}>

type ShutdownSignal = 'SIGINT' | 'SIGTERM'

type ShutdownSignals = Readonly<{
  once(signal: ShutdownSignal, handler: () => void): void
  removeListener(signal: ShutdownSignal, handler: () => void): void
}>

export type NextOidcLifecycleDependencies = Readonly<{
  application: BrowserAuthApplicationConfig
  createProvider: (config: Readonly<{
    issuer: string
    clientId: string
    clientSecret: string
    allowInsecureLocalHttp?: boolean
    now: () => Date
  }>) => Promise<ReadyOidcProvider>
  createRuntime: (config: OidcProcessRuntimeConfig) => Promise<OidcProcessRuntime>
  scheduleInterval?: (task: () => void, milliseconds: number) => IntervalHandle
  cancelInterval?: (handle: IntervalHandle) => void
  now?: () => Date
  waitForRetry?: (milliseconds: number) => Promise<void>
  reportCleanupFailure?: () => void
  reportShutdownFailure?: () => void
  shutdownSignals?: ShutdownSignals
}>

export type NextOidcLifecycle = ReturnType<typeof createNextOidcLifecycle>
export type OidcLifecycleInstallation = Readonly<{ state: 'disabled' | 'ready' }>

function activationState(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
): boolean {
  const activation = environment[
    browserAuthEnvironmentName(application, 'OIDC_RUNTIME_ENABLED')
  ]
  if (activation === undefined || activation === 'false') return false
  if (activation === 'true') return true
  throw new Error('OIDC process runtime activation is invalid')
}

function cleanupIntervalMilliseconds(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
): number {
  const seconds = Number(environment[
    browserAuthEnvironmentName(application, 'OIDC_CLEANUP_INTERVAL_SECONDS')
  ])
  const maximumSeconds = Math.floor(2_147_483_647 / 1_000)
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > maximumSeconds) {
    throw new Error('OIDC process runtime lifecycle configuration is invalid')
  }
  return seconds * 1_000
}

export function createNextOidcLifecycle(dependencies: NextOidcLifecycleDependencies) {
  const now = dependencies.now ?? (() => new Date())
  const waitForRetry = dependencies.waitForRetry ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const scheduleInterval = dependencies.scheduleInterval ?? ((task, milliseconds) => {
    const handle = setInterval(task, milliseconds)
    return handle
  })
  const cancelInterval = dependencies.cancelInterval ?? ((handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>)
  })
  const reportCleanupFailure = dependencies.reportCleanupFailure ??
    (() => console.error('Place OIDC expiry cleanup failed'))
  const reportShutdownFailure = dependencies.reportShutdownFailure ??
    (() => console.error('Place OIDC shutdown failed'))
  const shutdownSignals = dependencies.shutdownSignals ?? {
    once: (signal: ShutdownSignal, handler: () => void) => {
      process.once(signal, handler)
    },
    removeListener: (signal: ShutdownSignal, handler: () => void) => {
      process.removeListener(signal, handler)
    },
  }
  const supportedShutdownSignals = ['SIGINT', 'SIGTERM'] as const
  let installationPromise: Promise<OidcLifecycleInstallation> | undefined
  let cleanupPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  let intervalHandle: IntervalHandle | undefined
  let runtime: OidcProcessRuntime | undefined
  let shutdownHandlersRegistered = false

  function handleShutdown(): void {
    void close().catch(() => reportShutdownFailure())
  }

  function requestCleanup(): void {
    if (runtime === undefined || cleanupPromise !== undefined) return
    cleanupPromise = runtime
      .cleanupExpired()
      .then(() => undefined)
      .catch(() => reportCleanupFailure())
      .finally(() => {
        cleanupPromise = undefined
      })
  }

  async function installOnce(
    environment: BrowserAuthEnvironment,
  ): Promise<OidcLifecycleInstallation> {
    if (!activationState(environment, dependencies.application)) {
      return { state: 'disabled' }
    }
    const cleanupMilliseconds = cleanupIntervalMilliseconds(
      environment,
      dependencies.application,
    )
    const config = await loadOidcProcessRuntimeConfig(
      environment,
      dependencies.application,
    )
    const provider = await dependencies.createProvider({
      ...config.providerConfig,
      now,
    })
    const runtimeConfig: OidcProcessRuntimeConfig = {
      application: dependencies.application,
      database: config.database,
      encryption: config.encryption,
      bffConfig: config.bffConfig,
      cleanupBatchSize: config.cleanupBatchSize,
      provider,
      now,
    }
    for (let attempt = 1; attempt <= config.startupRetry.attempts; attempt += 1) {
      try {
        runtime = await dependencies.createRuntime(runtimeConfig)
        break
      } catch (error) {
        if (attempt === config.startupRetry.attempts) throw error
        await waitForRetry(config.startupRetry.delayMilliseconds)
      }
    }
    if (runtime === undefined) throw new Error('OIDC process runtime startup failed')
    intervalHandle = scheduleInterval(requestCleanup, cleanupMilliseconds)
    intervalHandle.unref?.()
    for (const signal of supportedShutdownSignals) {
      shutdownSignals.once(signal, handleShutdown)
    }
    shutdownHandlersRegistered = true
    return { state: 'ready' }
  }

  function close(): Promise<void> {
    closePromise ??= (async () => {
      await installationPromise?.catch(() => undefined)
      if (shutdownHandlersRegistered) {
        for (const signal of supportedShutdownSignals) {
          shutdownSignals.removeListener(signal, handleShutdown)
        }
        shutdownHandlersRegistered = false
      }
      if (intervalHandle !== undefined) {
        cancelInterval(intervalHandle)
        intervalHandle = undefined
      }
      await cleanupPromise
      const installedRuntime = runtime
      runtime = undefined
      await installedRuntime?.close()
    })()
    return closePromise
  }

  return {
    install(environment: BrowserAuthEnvironment): Promise<OidcLifecycleInstallation> {
      installationPromise ??= installOnce(environment)
      return installationPromise
    },
    current(): OidcProcessRuntime | undefined {
      return runtime
    },
    close,
  }
}

type GlobalLifecycleEntry = Readonly<{
  application: BrowserAuthApplicationConfig
  lifecycle: NextOidcLifecycle
}>

const lifecycleRegistry = globalThis as unknown as Record<
  symbol,
  GlobalLifecycleEntry | undefined
>

function sameApplication(
  left: BrowserAuthApplicationConfig,
  right: BrowserAuthApplicationConfig,
): boolean {
  return left.storageNamespace === right.storageNamespace &&
    left.environmentPrefix === right.environmentPrefix &&
    left.transactionCookieName === right.transactionCookieName &&
    left.sessionCookieName === right.sessionCookieName &&
    left.lifecycleKey === right.lifecycleKey
}

export function getOrCreateGlobalNextOidcLifecycle(
  dependencies: NextOidcLifecycleDependencies,
): NextOidcLifecycle {
  const key = Symbol.for(dependencies.application.lifecycleKey)
  const existing = lifecycleRegistry[key]
  if (existing !== undefined) {
    if (!sameApplication(existing.application, dependencies.application)) {
      throw new Error('Browser authentication lifecycle key is already in use')
    }
    return existing.lifecycle
  }
  const lifecycle = createNextOidcLifecycle(dependencies)
  lifecycleRegistry[key] = {
    application: dependencies.application,
    lifecycle,
  }
  return lifecycle
}

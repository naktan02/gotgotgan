import { loadOidcProcessRuntimeConfig } from './oidc-runtime-config'
import type { OidcProvider } from './oidc-bff'
import {
  createOidcProcessRuntime,
  type OidcProcessRuntimeConfig,
} from './oidc-process-runtime'
import { createOpenidClientProvider } from './openid-client-provider'

type Environment = Readonly<Record<string, string | undefined>>

type IntervalHandle = Readonly<{
  unref?: () => void
}>

type ShutdownSignal = 'SIGINT' | 'SIGTERM'

type ShutdownSignals = Readonly<{
  once(signal: ShutdownSignal, handler: () => void): void
  removeListener(signal: ShutdownSignal, handler: () => void): void
}>

type NextOidcRuntime = Awaited<ReturnType<typeof createOidcProcessRuntime>>

type LifecycleDependencies = Readonly<{
  createProvider: (config: Readonly<{
    issuer: string
    clientId: string
    clientSecret: string
    now: () => Date
  }>) => Promise<OidcProvider>
  createRuntime: (config: OidcProcessRuntimeConfig) => Promise<NextOidcRuntime>
  scheduleInterval?: (task: () => void, milliseconds: number) => IntervalHandle
  cancelInterval?: (handle: IntervalHandle) => void
  now?: () => Date
  reportCleanupFailure?: () => void
  reportShutdownFailure?: () => void
  shutdownSignals?: ShutdownSignals
}>

type Installation = Readonly<{ state: 'disabled' | 'ready' }>

function activationState(environment: Environment): boolean {
  const activation = environment.PLACE_OIDC_RUNTIME_ENABLED
  if (activation === undefined || activation === 'false') return false
  if (activation === 'true') return true
  throw new Error('OIDC process runtime activation is invalid')
}

function cleanupIntervalMilliseconds(environment: Environment): number {
  const seconds = Number(environment.PLACE_OIDC_CLEANUP_INTERVAL_SECONDS)
  const maximumSeconds = Math.floor(2_147_483_647 / 1_000)
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > maximumSeconds) {
    throw new Error('OIDC process runtime lifecycle configuration is invalid')
  }
  return seconds * 1_000
}

export function createNextOidcLifecycle(dependencies: LifecycleDependencies) {
  const now = dependencies.now ?? (() => new Date())
  const scheduleInterval = dependencies.scheduleInterval ?? ((task, milliseconds) => {
    const handle = setInterval(task, milliseconds)
    return handle
  })
  const cancelInterval = dependencies.cancelInterval ?? ((handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>)
  })
  const reportCleanupFailure =
    dependencies.reportCleanupFailure ??
    (() => console.error('Place OIDC expiry cleanup failed'))
  const reportShutdownFailure =
    dependencies.reportShutdownFailure ??
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
  let installationPromise: Promise<Installation> | undefined
  let cleanupPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  let intervalHandle: IntervalHandle | undefined
  let runtime: NextOidcRuntime | undefined
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

  async function installOnce(environment: Environment): Promise<Installation> {
    if (!activationState(environment)) return { state: 'disabled' }
    const cleanupMilliseconds = cleanupIntervalMilliseconds(environment)
    const config = await loadOidcProcessRuntimeConfig(environment)
    const provider = await dependencies.createProvider({
      ...config.providerConfig,
      now,
    })
    runtime = await dependencies.createRuntime({
      database: config.database,
      encryption: config.encryption,
      bffConfig: config.bffConfig,
      cleanupBatchSize: config.cleanupBatchSize,
      provider,
      now,
    })
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
    install(environment: Environment): Promise<Installation> {
      installationPromise ??= installOnce(environment)
      return installationPromise
    },
    current(): NextOidcRuntime | undefined {
      return runtime
    },
    close,
  }
}

const nextOidcLifecycle = createNextOidcLifecycle({
  createProvider: createOpenidClientProvider,
  createRuntime: createOidcProcessRuntime,
})

export function installNextOidcRuntime(
  environment: Environment = process.env,
): Promise<Installation> {
  return nextOidcLifecycle.install(environment)
}

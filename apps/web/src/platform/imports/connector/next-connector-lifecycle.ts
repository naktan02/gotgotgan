import {
  createConnectorBackendClient,
  type ConnectorBackendClientConfig,
} from './connector-backend-client'

type Environment = Readonly<Record<string, string | undefined>>
type ConnectorBackend = ReturnType<typeof createConnectorBackendClient>
type Installation = Readonly<{ state: 'disabled' | 'ready' }>

function activationState(environment: Environment): boolean {
  const activation = environment.PLACE_CONNECTOR_RUNTIME_ENABLED
  if (activation === undefined || activation === 'false') return false
  if (activation === 'true') return true
  throw new Error('Connector runtime activation is invalid')
}

function required(environment: Environment, name: string): string {
  const value = environment[name]
  if (value === undefined || value === '') throw new Error('Connector runtime configuration is invalid')
  return value
}

export function createNextConnectorLifecycle(dependencies: Readonly<{
  createBackend: (config: ConnectorBackendClientConfig) => ConnectorBackend
}>) {
  let installationPromise: Promise<Installation> | undefined
  let backend: ConnectorBackend | undefined
  return {
    install(environment: Environment): Promise<Installation> {
      installationPromise ??= Promise.resolve().then(() => {
        if (!activationState(environment)) return { state: 'disabled' as const }
        const timeout = Number(required(environment, 'PLACE_CONNECTOR_BACKEND_TIMEOUT_MILLISECONDS'))
        if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 60_000) {
          throw new Error('Connector runtime configuration is invalid')
        }
        backend = dependencies.createBackend({
          origin: required(environment, 'PLACE_BACKEND_ORIGIN'),
          timeoutMilliseconds: timeout,
        })
        return { state: 'ready' as const }
      })
      return installationPromise
    },
    current(): ConnectorBackend | undefined {
      return backend
    },
  }
}

const lifecycleKey = Symbol.for('place.web.connector.lifecycle')
const lifecycleRegistry = globalThis as unknown as Record<
  symbol,
  ReturnType<typeof createNextConnectorLifecycle> | undefined
>
const nextConnectorLifecycle = lifecycleRegistry[lifecycleKey] ?? createNextConnectorLifecycle({
  createBackend: createConnectorBackendClient,
})
lifecycleRegistry[lifecycleKey] = nextConnectorLifecycle

export function installNextConnectorRuntime(
  environment: Environment = process.env,
): Promise<Installation> {
  return nextConnectorLifecycle.install(environment)
}

export function readNextConnectorRuntime(): ConnectorBackend | undefined {
  return nextConnectorLifecycle.current()
}

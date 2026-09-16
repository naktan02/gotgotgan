import {
  createConnectorTransferBackendClient,
  type ConnectorTransferBackendClientConfig,
} from '../transfers/connector-transfer-backend-client'

type Environment = Readonly<Record<string, string | undefined>>
type ConnectorTransferBackend = ReturnType<typeof createConnectorTransferBackendClient>
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
  createTransferBackend: (
    config: ConnectorTransferBackendClientConfig,
  ) => ConnectorTransferBackend
}>) {
  let installationPromise: Promise<Installation> | undefined
  let transferBackend: ConnectorTransferBackend | undefined
  return {
    install(environment: Environment): Promise<Installation> {
      installationPromise ??= Promise.resolve().then(() => {
        if (!activationState(environment)) return { state: 'disabled' as const }
        const timeout = Number(required(environment, 'PLACE_CONNECTOR_BACKEND_TIMEOUT_MILLISECONDS'))
        if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 60_000) {
          throw new Error('Connector runtime configuration is invalid')
        }
        const config = {
          origin: required(environment, 'PLACE_BACKEND_ORIGIN'),
          publicOrigin: required(environment, 'PLACE_CONNECTOR_PUBLIC_ORIGIN'),
          timeoutMilliseconds: timeout,
        }
        const nextTransferBackend = dependencies.createTransferBackend(config)
        transferBackend = nextTransferBackend
        return { state: 'ready' as const }
      })
      return installationPromise
    },
    current(): ConnectorTransferBackend | undefined {
      return transferBackend
    },
  }
}

const lifecycleKey = Symbol.for('place.web.connector.lifecycle')
const lifecycleRegistry = globalThis as unknown as Record<
  symbol,
  ReturnType<typeof createNextConnectorLifecycle> | undefined
>
const nextConnectorLifecycle = lifecycleRegistry[lifecycleKey] ?? createNextConnectorLifecycle({
  createTransferBackend: createConnectorTransferBackendClient,
})
lifecycleRegistry[lifecycleKey] = nextConnectorLifecycle

export function installNextConnectorRuntime(
  environment: Environment = process.env,
): Promise<Installation> {
  return nextConnectorLifecycle.install(environment)
}

export function readNextConnectorTransferRuntime(): ConnectorTransferBackend | undefined {
  return nextConnectorLifecycle.current()
}

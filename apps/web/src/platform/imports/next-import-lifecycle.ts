import {
  createImportBackendClient,
  type ImportBackendClientConfig,
} from './import-backend-client'

type Environment = Readonly<Record<string, string | undefined>>
type ImportBackend = ReturnType<typeof createImportBackendClient>
type Installation = Readonly<{ state: 'disabled' | 'ready' }>

type Dependencies = Readonly<{
  createBackend: (config: ImportBackendClientConfig) => ImportBackend
}>

function activationState(environment: Environment): boolean {
  const activation = environment.PLACE_IMPORT_RUNTIME_ENABLED
  if (activation === undefined || activation === 'false') return false
  if (activation === 'true') return true
  throw new Error('Import runtime activation is invalid')
}

function required(environment: Environment, name: string): string {
  const value = environment[name]
  if (value === undefined || value === '') throw new Error('Import runtime configuration is invalid')
  return value
}

function timeoutMilliseconds(environment: Environment): number {
  const value = Number(required(environment, 'PLACE_IMPORT_BACKEND_TIMEOUT_MILLISECONDS'))
  if (!Number.isInteger(value) || value <= 0 || value > 60_000) {
    throw new Error('Import runtime configuration is invalid')
  }
  return value
}

export function createNextImportLifecycle(dependencies: Dependencies) {
  let installationPromise: Promise<Installation> | undefined
  let backend: ImportBackend | undefined

  async function installOnce(environment: Environment): Promise<Installation> {
    if (!activationState(environment)) return { state: 'disabled' }
    backend = dependencies.createBackend({
      origin: required(environment, 'PLACE_BACKEND_ORIGIN'),
      timeoutMilliseconds: timeoutMilliseconds(environment),
    })
    return { state: 'ready' }
  }

  return {
    install(environment: Environment): Promise<Installation> {
      installationPromise ??= installOnce(environment)
      return installationPromise
    },
    current(): ImportBackend | undefined {
      return backend
    },
  }
}

const lifecycleKey = Symbol.for('place.web.import.lifecycle')
const lifecycleRegistry = globalThis as unknown as Record<
  symbol,
  ReturnType<typeof createNextImportLifecycle> | undefined
>
const nextImportLifecycle = lifecycleRegistry[lifecycleKey] ?? createNextImportLifecycle({
  createBackend: createImportBackendClient,
})
lifecycleRegistry[lifecycleKey] = nextImportLifecycle

export function installNextImportRuntime(
  environment: Environment = process.env,
): Promise<Installation> {
  return nextImportLifecycle.install(environment)
}

export function readNextImportRuntime(): ImportBackend | undefined {
  return nextImportLifecycle.current()
}

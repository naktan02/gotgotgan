import {
  createMembershipBackendClient,
  type MembershipBackendClientConfig,
} from './membership-backend-client'

type Environment = Readonly<Record<string, string | undefined>>
type MembershipBackend = ReturnType<typeof createMembershipBackendClient>
type Installation = Readonly<{ state: 'disabled' | 'ready' }>

type Dependencies = Readonly<{
  createBackend: (config: MembershipBackendClientConfig) => MembershipBackend
}>

function activationState(environment: Environment): boolean {
  const activation = environment.PLACE_MEMBERSHIP_RUNTIME_ENABLED
  if (activation === undefined || activation === 'false') return false
  if (activation === 'true') return true
  throw new Error('Membership runtime activation is invalid')
}

function required(environment: Environment, name: string): string {
  const value = environment[name]
  if (value === undefined || value === '') {
    throw new Error('Membership runtime configuration is invalid')
  }
  return value
}

function timeoutMilliseconds(environment: Environment): number {
  const value = Number(
    required(environment, 'PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS'),
  )
  if (!Number.isInteger(value) || value <= 0 || value > 60_000) {
    throw new Error('Membership runtime configuration is invalid')
  }
  return value
}

export function createNextMembershipLifecycle(dependencies: Dependencies) {
  let installationPromise: Promise<Installation> | undefined
  let backend: MembershipBackend | undefined

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
    current(): MembershipBackend | undefined {
      return backend
    },
  }
}

const lifecycleKey = Symbol.for('place.web.membership.lifecycle')
const lifecycleRegistry = globalThis as unknown as Record<
  symbol,
  ReturnType<typeof createNextMembershipLifecycle> | undefined
>
const nextMembershipLifecycle =
  lifecycleRegistry[lifecycleKey] ??
  createNextMembershipLifecycle({ createBackend: createMembershipBackendClient })
lifecycleRegistry[lifecycleKey] = nextMembershipLifecycle

export function installNextMembershipRuntime(
  environment: Environment = process.env,
): Promise<Installation> {
  return nextMembershipLifecycle.install(environment)
}

export function readNextMembershipRuntime(): MembershipBackend | undefined {
  return nextMembershipLifecycle.current()
}

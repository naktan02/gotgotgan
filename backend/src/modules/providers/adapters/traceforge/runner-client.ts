import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

import { ForgeSdk } from '@traceforge/runner-sdk'

export type ForgeRecipeRequest = Readonly<{
  inputs: Readonly<Record<string, string>>
  packId: string
  packVersion: string
  recipeId: string
  version: 1
}>

export type ForgeRecipeResult =
  | Readonly<{
      outputs: Readonly<Record<string, unknown>>
      state: 'succeeded'
      version: 1
    }>
  | Readonly<{
      code: string
      message: string
      state: 'failed' | 'needs-user-action'
      version: 1
    }>

export interface ForgeRecipeClient {
  run(request: ForgeRecipeRequest, signal: AbortSignal): Promise<ForgeRecipeResult>
}

export type TraceForgeRunnerClientOptions = Readonly<{
  command?: string
  packFiles: readonly string[]
  profilePrefix?: string
  profileRoot: string
  runnerFile: string
  startupTimeoutMilliseconds?: number
}>

type RunnerSdk = Readonly<{
  close(): Promise<void>
  run(request: ForgeRecipeRequest): Promise<ForgeRecipeResult>
}>

type RunnerSession = {
  cleanup: Promise<void> | undefined
  profileDirectory: string
  sdk: RunnerSdk
}

export class TraceForgeRunnerClient implements ForgeRecipeClient {
  readonly #options: Required<Pick<TraceForgeRunnerClientOptions, 'command' | 'profilePrefix'>> &
    Omit<TraceForgeRunnerClientOptions, 'command' | 'profilePrefix'>
  #active = false
  #closed = false
  #closing: Promise<void> | undefined
  #session: RunnerSession | undefined
  #starting: Promise<RunnerSession> | undefined

  constructor(options: TraceForgeRunnerClientOptions) {
    const profilePrefix = options.profilePrefix ?? 'traceforge-anonymous-'
    const startupTimeoutMilliseconds = options.startupTimeoutMilliseconds
    if (
      options.packFiles.length === 0 ||
      options.packFiles.some((file) => file.length === 0) ||
      options.profileRoot.length === 0 ||
      options.runnerFile.length === 0 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?-$/.test(profilePrefix) ||
      (startupTimeoutMilliseconds !== undefined && (
        !Number.isSafeInteger(startupTimeoutMilliseconds) ||
        startupTimeoutMilliseconds <= 0 ||
        startupTimeoutMilliseconds > 60_000
      ))
    ) throw new Error('TraceForge Runner client configuration is invalid.')
    this.#options = {
      ...options,
      command: options.command ?? process.execPath,
      profilePrefix,
    }
  }

  async run(request: ForgeRecipeRequest, signal: AbortSignal): Promise<ForgeRecipeResult> {
    if (this.#closed) throw new Error('TraceForge Runner client is closed.')
    if (this.#active) throw new Error('TraceForge Runner client only supports one active run.')
    if (signal.aborted) throw abortError()
    this.#active = true
    let removeAbortListener = () => undefined
    try {
      const session = await this.#getSession()
      if (signal.aborted) {
        await this.#disposeSession(session)
        throw abortError()
      }
      const operation = session.sdk.run(request).then(
        (value) => ({ kind: 'result' as const, value }),
        (error: unknown) => ({ error, kind: 'error' as const }),
      )
      const cancellation = new Promise<{ kind: 'aborted' }>((resolve) => {
        const onAbort = () => resolve({ kind: 'aborted' })
        signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => {
          signal.removeEventListener('abort', onAbort)
        }
      })
      const outcome = await Promise.race([operation, cancellation])
      if (outcome.kind === 'aborted') {
        const cleanup = await settled(this.#disposeSession(session))
        await operation
        if (cleanup.status === 'rejected') throw cleanup.reason
        throw abortError()
      }
      if (outcome.kind === 'error') {
        const cleanup = await settled(this.#disposeSession(session))
        if (cleanup.status === 'rejected') {
          throw new AggregateError(
            [outcome.error, cleanup.reason],
            'TraceForge Runner transport and cleanup failed.',
          )
        }
        throw outcome.error
      }
      return outcome.value
    } finally {
      removeAbortListener()
      this.#active = false
    }
  }

  async close(): Promise<void> {
    if (this.#closing !== undefined) return await this.#closing
    this.#closed = true
    this.#closing = this.#closeOwnedResources()
    return await this.#closing
  }

  async #closeOwnedResources(): Promise<void> {
    const starting = this.#starting
    if (starting !== undefined) await settled(starting)
    const session = this.#session
    if (session !== undefined) await this.#disposeSession(session)
  }

  async #getSession(): Promise<RunnerSession> {
    if (this.#session !== undefined) return this.#session
    if (this.#starting === undefined) {
      this.#starting = this.#startSession().finally(() => {
        this.#starting = undefined
      })
    }
    return await this.#starting
  }

  async #startSession(): Promise<RunnerSession> {
    await mkdir(this.#options.profileRoot, { recursive: true })
    const profileDirectory = await mkdtemp(path.join(
      this.#options.profileRoot,
      this.#options.profilePrefix,
    ))
    let sdk: RunnerSdk
    try {
      sdk = await ForgeSdk.start({
        arguments: [
          this.#options.runnerFile,
          '--headless',
          'true',
          ...this.#options.packFiles.flatMap((file) => ['--pack', file]),
          '--profile-directory',
          profileDirectory,
        ],
        command: this.#options.command,
        ...(this.#options.startupTimeoutMilliseconds === undefined
          ? {}
          : { startupTimeoutMs: this.#options.startupTimeoutMilliseconds }),
      })
    } catch (error) {
      const removal = await settled(rm(profileDirectory, { force: true, recursive: true }))
      if (removal.status === 'rejected') {
        throw new AggregateError([error, removal.reason], 'TraceForge Runner startup cleanup failed.')
      }
      throw error
    }
    const session = { cleanup: undefined, profileDirectory, sdk }
    if (this.#closed) {
      await this.#disposeSession(session)
      throw new Error('TraceForge Runner client is closed.')
    }
    this.#session = session
    return session
  }

  async #disposeSession(session: RunnerSession): Promise<void> {
    session.cleanup ??= disposeSession(session)
    try {
      await session.cleanup
    } finally {
      if (this.#session === session) this.#session = undefined
    }
  }
}

async function disposeSession(session: RunnerSession): Promise<void> {
  const failures: unknown[] = []
  try {
    await session.sdk.close()
  } catch (error) {
    failures.push(error)
  }
  try {
    await rm(session.profileDirectory, { force: true, recursive: true })
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'TraceForge Runner session cleanup failed.')
  }
}

function abortError(): Error {
  const error = new Error('TraceForge Runner run was aborted.')
  error.name = 'AbortError'
  return error
}

async function settled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise }
  } catch (reason) {
    return { reason, status: 'rejected' }
  }
}

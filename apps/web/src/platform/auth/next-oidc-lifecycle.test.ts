import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createNextOidcLifecycle } from './next-oidc-lifecycle'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function secretFile(directory: string, name: string, value: string): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, `${value}\n`, { mode: 0o600 })
  return path
}

async function activeEnvironment(directory: string): Promise<Readonly<Record<string, string>>> {
  return {
    PLACE_OIDC_RUNTIME_ENABLED: 'true',
    PLACE_DATABASE_URL_FILE: await secretFile(
      directory,
      'database-url',
      'postgresql://place_app:database-secret@database.example/place',
    ),
    PLACE_OIDC_CLIENT_SECRET_FILE: await secretFile(
      directory,
      'client-secret',
      'oidc-client-secret',
    ),
    PLACE_OIDC_ENCRYPTION_KEYRING_FILE: await secretFile(
      directory,
      'encryption-keyring',
      JSON.stringify({
        activeKeyId: 'key-v1',
        keys: [{ id: 'key-v1', value: Buffer.alloc(32, 7).toString('base64url') }],
      }),
    ),
    PLACE_OIDC_ISSUER: 'https://identity.example',
    PLACE_OIDC_CLIENT_ID: 'place-client',
    PLACE_OIDC_CALLBACK_URL: 'https://place.example/api/auth/oidc/callback',
    PLACE_OIDC_POST_LOGIN_PATH: '/',
    PLACE_OIDC_SCOPES: 'openid',
    PLACE_OIDC_TRANSACTION_TTL_SECONDS: '300',
    PLACE_OIDC_SESSION_TTL_SECONDS: '3600',
    PLACE_OIDC_DATABASE_MAX_CONNECTIONS: '4',
    PLACE_OIDC_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '30000',
    PLACE_OIDC_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '5000',
    PLACE_OIDC_CLEANUP_BATCH_SIZE: '250',
    PLACE_OIDC_CLEANUP_INTERVAL_SECONDS: '60',
  }
}

describe('Next OIDC process lifecycle', () => {
  it('keeps the source-only Web runtime inactive unless activation is explicit', async () => {
    let providerCreated = false
    let runtimeCreated = false
    const lifecycle = createNextOidcLifecycle({
      createProvider: async () => {
        providerCreated = true
        throw new Error('must not create a provider')
      },
      createRuntime: async () => {
        runtimeCreated = true
        throw new Error('must not create a runtime')
      },
    })

    await expect(lifecycle.install({})).resolves.toEqual({ state: 'disabled' })
    expect(lifecycle.current()).toBeUndefined()
    expect(providerCreated).toBe(false)
    expect(runtimeCreated).toBe(false)
  })

  it('rejects an ambiguous activation value instead of silently disabling authentication', async () => {
    const lifecycle = createNextOidcLifecycle({
      createProvider: async () => {
        throw new Error('must not create a provider')
      },
      createRuntime: async () => {
        throw new Error('must not create a runtime')
      },
    })

    await expect(
      lifecycle.install({ PLACE_OIDC_RUNTIME_ENABLED: 'tru' }),
    ).rejects.toThrow('OIDC process runtime activation is invalid')
  })

  it('installs one runtime and owns periodic cleanup and close', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-next-oidc-lifecycle-'))
    temporaryDirectories.push(directory)
    const environment = await activeEnvironment(directory)
    let providerCreations = 0
    let runtimeCreations = 0
    let cleanupCalls = 0
    let closeCalls = 0
    let cancelled = false
    let scheduledMilliseconds: number | undefined
    let scheduledTask: (() => void) | undefined
    const provider = {
      buildAuthorizationUrl: async () => 'https://identity.example/authorize',
      exchangeAuthorizationCode: async () => ({
        accessToken: 'server-side-token',
        expiresAt: '2026-08-26T01:00:00.000Z',
      }),
    }
    const runtime = {
      bff: {
        start: async () => new Response(null),
        callback: async () => new Response(null),
        logout: async () => new Response(null),
        resolveSession: async () => undefined,
      },
      cleanupExpired: async () => {
        cleanupCalls += 1
        return { transactionsDeleted: 0, sessionsDeleted: 0 }
      },
      close: async () => {
        closeCalls += 1
      },
    }
    const lifecycle = createNextOidcLifecycle({
      createProvider: async (config) => {
        providerCreations += 1
        expect(config).toMatchObject({
          issuer: 'https://identity.example',
          clientId: 'place-client',
          clientSecret: 'oidc-client-secret',
        })
        return provider
      },
      createRuntime: async (config) => {
        runtimeCreations += 1
        expect(config).toMatchObject({
          database: { maxConnections: 4 },
          cleanupBatchSize: 250,
          provider,
        })
        return runtime
      },
      scheduleInterval: (task, milliseconds) => {
        scheduledTask = task
        scheduledMilliseconds = milliseconds
        return { unref: () => undefined }
      },
      cancelInterval: () => {
        cancelled = true
      },
    })

    await expect(Promise.all([
      lifecycle.install(environment),
      lifecycle.install(environment),
    ])).resolves.toEqual([{ state: 'ready' }, { state: 'ready' }])
    expect(providerCreations).toBe(1)
    expect(runtimeCreations).toBe(1)
    expect(lifecycle.current()).toBe(runtime)
    expect(scheduledMilliseconds).toBe(60_000)

    scheduledTask?.()
    await Promise.resolve()
    expect(cleanupCalls).toBe(1)

    await lifecycle.close()
    await lifecycle.close()
    expect(cancelled).toBe(true)
    expect(closeCalls).toBe(1)
    expect(lifecycle.current()).toBeUndefined()
  })

  it('closes the runtime when the Next process receives a shutdown signal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-next-oidc-lifecycle-'))
    temporaryDirectories.push(directory)
    const handlers = new Map<string, () => void>()
    const removed: string[] = []
    let closeCalls = 0
    const lifecycle = createNextOidcLifecycle({
      createProvider: async () => ({
        buildAuthorizationUrl: async () => 'https://identity.example/authorize',
        exchangeAuthorizationCode: async () => ({
          accessToken: 'server-side-token',
          expiresAt: '2026-08-26T01:00:00.000Z',
        }),
      }),
      createRuntime: async () => ({
        bff: {
          start: async () => new Response(null),
          callback: async () => new Response(null),
          logout: async () => new Response(null),
          resolveSession: async () => undefined,
        },
        cleanupExpired: async () => ({ transactionsDeleted: 0, sessionsDeleted: 0 }),
        close: async () => {
          closeCalls += 1
        },
      }),
      scheduleInterval: () => ({ unref: () => undefined }),
      cancelInterval: () => undefined,
      shutdownSignals: {
        once: (signal, handler) => void handlers.set(signal, handler),
        removeListener: (signal) => void removed.push(signal),
      },
    })
    await lifecycle.install(await activeEnvironment(directory))

    expect([...handlers.keys()]).toEqual(['SIGINT', 'SIGTERM'])
    handlers.get('SIGTERM')?.()
    await lifecycle.close()

    expect(closeCalls).toBe(1)
    expect(removed).toEqual(['SIGINT', 'SIGTERM'])
  })
})

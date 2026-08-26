import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadOidcProcessRuntimeConfig } from './oidc-runtime-config'

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

async function validEnvironment(
  directory: string,
  overrides: Readonly<Record<string, string>> = {},
  keyring: unknown = {
    activeKeyId: 'key-v1',
    keys: [{ id: 'key-v1', value: Buffer.alloc(32, 7).toString('base64url') }],
  },
): Promise<Readonly<Record<string, string>>> {
  return {
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
      JSON.stringify(keyring),
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
    ...overrides,
  }
}

describe('OIDC process runtime configuration', () => {
  it('loads credentials and rotation keys only through referenced secret files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-oidc-config-'))
    temporaryDirectories.push(directory)
    const activeKey = Buffer.alloc(32, 7).toString('base64url')
    const retainedKey = Buffer.alloc(32, 3).toString('base64url')
    const environment = await validEnvironment(
      directory,
      { PLACE_OIDC_SCOPES: 'openid profile' },
      {
        activeKeyId: 'key-v2',
        keys: [
          { id: 'key-v2', value: activeKey },
          { id: 'key-v1', value: retainedKey },
        ],
      },
    )

    const config = await loadOidcProcessRuntimeConfig(environment)

    expect(config).toMatchObject({
      database: {
        connectionString: 'postgresql://place_app:database-secret@database.example/place',
        maxConnections: 4,
        idleTimeoutMilliseconds: 30_000,
        connectionTimeoutMilliseconds: 5_000,
      },
      providerConfig: {
        issuer: 'https://identity.example',
        clientId: 'place-client',
        clientSecret: 'oidc-client-secret',
      },
      bffConfig: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid', 'profile'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      cleanupBatchSize: 250,
      encryption: {
        activeKey: { id: 'key-v2' },
        decryptionKeys: [{ id: 'key-v1' }],
      },
    })
    expect([...config.encryption.activeKey.value]).toEqual([...Buffer.alloc(32, 7)])
    expect([...(config.encryption.decryptionKeys?.[0]?.value ?? [])]).toEqual([
      ...Buffer.alloc(32, 3),
    ])
  })

  it('rejects an unbounded cleanup batch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-oidc-config-'))
    temporaryDirectories.push(directory)
    const environment = await validEnvironment(directory, {
      PLACE_OIDC_CLEANUP_BATCH_SIZE: '1001',
    })

    await expect(loadOidcProcessRuntimeConfig(environment)).rejects.toThrow(
      'OIDC process runtime configuration is invalid',
    )
  })

  it('rejects an insecure Identity issuer before returning runtime configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-oidc-config-'))
    temporaryDirectories.push(directory)
    const environment = await validEnvironment(directory, {
      PLACE_OIDC_ISSUER: 'http://identity.internal.example',
    })

    await expect(loadOidcProcessRuntimeConfig(environment)).rejects.toThrow(
      'OIDC process runtime configuration is invalid',
    )
  })

  it('allows explicit HTTP only for a local Identity issuer and callback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-oidc-config-'))
    temporaryDirectories.push(directory)
    const environment = await validEnvironment(directory, {
      PLACE_OIDC_ALLOW_INSECURE_LOCAL_HTTP: 'true',
      PLACE_OIDC_ISSUER: 'http://identity.localhost',
      PLACE_OIDC_CALLBACK_URL: 'http://localhost:3000/api/auth/oidc/callback',
    })

    await expect(loadOidcProcessRuntimeConfig(environment)).resolves.toMatchObject({
      providerConfig: {
        issuer: 'http://identity.localhost',
        allowInsecureLocalHttp: true,
      },
      bffConfig: {
        callbackUrl: 'http://localhost:3000/api/auth/oidc/callback',
        allowInsecureLocalHttp: true,
      },
    })

    await expect(loadOidcProcessRuntimeConfig({
      ...environment,
      PLACE_OIDC_ISSUER: 'http://identity.internal.example',
    })).rejects.toThrow('OIDC process runtime configuration is invalid')
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  loadProductionHttpConfig,
  readHttpProcessMode,
  readHttpRuntimeConfig,
} from '../src/entrypoints/http/config.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function configurationEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): Promise<Readonly<Record<string, string>>> {
  const directory = await mkdtemp(join(tmpdir(), 'place-http-config-'))
  temporaryDirectories.push(directory)
  const databaseUrlFile = join(directory, 'database-url')
  const membershipPolicyFile = join(directory, 'membership-policy')
  await Promise.all([
    writeFile(
      databaseUrlFile,
      'postgresql://place_app:database-secret@database.example/place\n',
      { mode: 0o600 },
    ),
    writeFile(
      membershipPolicyFile,
      `${JSON.stringify({
        schemaVersion: 'place-membership-policy.v1',
        requiredConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
          { document: 'privacy-policy', version: '2026-08-26' },
        ],
        initialUserGrade: 'newcomer',
        initialProductTier: 'free',
      })}\n`,
      { mode: 0o600 },
    ),
  ])
  return {
    NODE_ENV: 'production',
    PLACE_HTTP_RUNTIME_MODE: 'production',
    PLACE_AUTH_MODE: 'oidc',
    PLACE_HTTP_HOST: 'place-backend.invalid',
    PLACE_HTTP_PORT: '4312',
    PLACE_DATABASE_URL_FILE: databaseUrlFile,
    PLACE_DATABASE_MAX_CONNECTIONS: '8',
    PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '30000',
    PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '5000',
    PLACE_MEMBERSHIP_POLICY_FILE: membershipPolicyFile,
    PLACE_CONNECTOR_RUNTIME_ENABLED: 'false',
    PLACE_OIDC_ISSUER: 'https://identity.example',
    PLACE_OIDC_AUDIENCE: 'place-backend',
    PLACE_OIDC_JWKS_URI: 'https://identity.example/oauth/v2/keys',
    PLACE_OIDC_REQUIRED_SCOPES: 'openid place.read',
    ...overrides,
  }
}

describe('HTTP runtime configuration', () => {
  it('requires an explicit source-only or production process mode', () => {
    expect(() => readHttpProcessMode({})).toThrow()
    expect(readHttpProcessMode({ PLACE_HTTP_RUNTIME_MODE: 'source-only' })).toBe(
      'source-only',
    )
    expect(readHttpProcessMode({ PLACE_HTTP_RUNTIME_MODE: 'production' })).toBe(
      'production',
    )
  })

  it('requires deployment-owned host and port values', () => {
    expect(() => readHttpRuntimeConfig({})).toThrow()
  })

  it('parses injected values without a repository address default', () => {
    expect(readHttpRuntimeConfig({ PLACE_HTTP_HOST: 'loopback.invalid', PLACE_HTTP_PORT: '4312' }))
      .toEqual({ host: 'loopback.invalid', port: 4312 })
  })

  it('loads one validated production composition without policy or address defaults', async () => {
    const config = await loadProductionHttpConfig(await configurationEnvironment())

    expect(config).toEqual({
      listener: { host: 'place-backend.invalid', port: 4312 },
      database: {
        connectionString: 'postgresql://place_app:database-secret@database.example/place',
        maxConnections: 8,
        idleTimeoutMilliseconds: 30_000,
        connectionTimeoutMilliseconds: 5_000,
      },
      authentication: {
        mode: 'oidc',
        oidc: {
          issuer: 'https://identity.example',
          audience: 'place-backend',
          jwksUri: 'https://identity.example/oauth/v2/keys',
          algorithms: ['RS256'],
          requiredScopes: ['openid', 'place.read'],
        },
      },
      membershipPolicy: {
        requiredConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
          { document: 'privacy-policy', version: '2026-08-26' },
        ],
        initialUserGrade: 'newcomer',
        initialProductTier: 'free',
      },
    })
  })

  it('rejects local auth and malformed policy without exposing protected values', async () => {
    const localAuth = await configurationEnvironment({
      NODE_ENV: 'test',
      PLACE_AUTH_MODE: 'test',
    })
    await expect(loadProductionHttpConfig(localAuth)).rejects.toThrow(
      'Production HTTP configuration is invalid',
    )

    const malformed = await configurationEnvironment()
    await writeFile(
      malformed.PLACE_MEMBERSHIP_POLICY_FILE!,
      '{"databaseSecret":"must-not-appear"}\n',
      { mode: 0o600 },
    )
    try {
      await loadProductionHttpConfig(malformed)
      throw new Error('expected configuration rejection')
    } catch (error) {
      expect(error).toEqual(new Error('Production HTTP configuration is invalid'))
      expect(String(error)).not.toContain('must-not-appear')
      expect(String(error)).not.toContain('database-secret')
    }
  })

  it('loads only complete deployment-owned official provider groups', async () => {
    const environment = await configurationEnvironment()
    const directory = dirname(environment.PLACE_DATABASE_URL_FILE!)
    const naverId = join(directory, 'naver-client-id')
    const naverSecret = join(directory, 'naver-client-secret')
    const kakaoKey = join(directory, 'kakao-key')
    const googleKey = join(directory, 'google-key')
    await Promise.all([
      writeFile(naverId, 'naver-id\n', { mode: 0o600 }),
      writeFile(naverSecret, 'naver-secret\n', { mode: 0o600 }),
      writeFile(kakaoKey, 'kakao-secret\n', { mode: 0o600 }),
      writeFile(googleKey, 'google-secret\n', { mode: 0o600 }),
    ])

    const config = await loadProductionHttpConfig({
      ...environment,
      PLACE_NAVER_SEARCH_ENDPOINT: 'https://naver-api.example/local.json',
      PLACE_NAVER_CLIENT_ID_FILE: naverId,
      PLACE_NAVER_CLIENT_SECRET_FILE: naverSecret,
      PLACE_NAVER_TIMEOUT_MILLISECONDS: '2500',
      PLACE_KAKAO_SEARCH_ENDPOINT: 'https://kakao-api.example/search/keyword.json',
      PLACE_KAKAO_REST_API_KEY_FILE: kakaoKey,
      PLACE_KAKAO_TIMEOUT_MILLISECONDS: '2500',
      PLACE_GOOGLE_PLACES_BASE_URL: 'https://places-api.example/v1/',
      PLACE_GOOGLE_PLACES_API_KEY_FILE: googleKey,
      PLACE_GOOGLE_TIMEOUT_MILLISECONDS: '2500',
    })

    expect(config.providers).toEqual({
      naver: {
        endpoint: new URL('https://naver-api.example/local.json'),
        clientId: 'naver-id', clientSecret: 'naver-secret', timeoutMilliseconds: 2500,
      },
      kakao: {
        endpoint: new URL('https://kakao-api.example/search/keyword.json'),
        restApiKey: 'kakao-secret', timeoutMilliseconds: 2500,
      },
      google: {
        baseUrl: new URL('https://places-api.example/v1/'),
        apiKey: 'google-secret', timeoutMilliseconds: 2500,
      },
    })
  })

  it('rejects partial provider groups and endpoints carrying credentials', async () => {
    await expect(loadProductionHttpConfig(await configurationEnvironment({
      PLACE_KAKAO_SEARCH_ENDPOINT: 'https://kakao-api.example/search/keyword.json',
    }))).rejects.toThrow('Production HTTP configuration is invalid')

    const environment = await configurationEnvironment()
    const key = join(dirname(environment.PLACE_DATABASE_URL_FILE!), 'google-key')
    await writeFile(key, 'google-secret\n', { mode: 0o600 })
    await expect(loadProductionHttpConfig({
      ...environment,
      PLACE_GOOGLE_PLACES_BASE_URL: 'https://secret@places-api.example/v1/',
      PLACE_GOOGLE_PLACES_API_KEY_FILE: key,
      PLACE_GOOGLE_TIMEOUT_MILLISECONDS: '2500',
    })).rejects.toThrow('Production HTTP configuration is invalid')
  })

  it('loads connector limits and protected capture storage only when explicitly enabled', async () => {
    const environment = await configurationEnvironment({ PLACE_CONNECTOR_RUNTIME_ENABLED: 'true' })
    const directory = dirname(environment.PLACE_DATABASE_URL_FILE!)
    const keyring = join(directory, 'capture-keyring')
    const captureRoot = join(directory, 'captures')
    await writeFile(keyring, `${JSON.stringify({
      schemaVersion: 'place-capture-keyring.v1',
      activeKeyId: 'connector-test',
      keys: [{ id: 'connector-test', material: Buffer.alloc(32, 7).toString('base64url') }],
    })}\n`, { mode: 0o600 })

    const config = await loadProductionHttpConfig({
      ...environment,
      PLACE_CONNECTOR_PUBLIC_ORIGIN: 'https://place.example',
      PLACE_CONNECTOR_GRANT_TTL_SECONDS: '600',
      PLACE_CONNECTOR_CAPTURE_RETENTION_SECONDS: '86400',
      PLACE_CONNECTOR_MAXIMUM_ITEMS: '10000',
      PLACE_CONNECTOR_MAXIMUM_BYTES: '10485760',
      PLACE_CONNECTOR_MAXIMUM_BATCHES: '100',
      PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES: '1048576',
      PLACE_CAPTURE_ROOT: captureRoot,
      PLACE_CAPTURE_KEYRING_FILE: keyring,
      PLACE_CAPTURE_MAXIMUM_BYTES: '1048576',
    })

    expect(config.connector).toMatchObject({
      publicOrigin: 'https://place.example',
      grantTtlMilliseconds: 600_000,
      captureRetentionMilliseconds: 86_400_000,
      limits: {
        maximumItems: 10_000, maximumBytes: 10_485_760,
        maximumBatches: 100, maximumBatchBytes: 1_048_576,
      },
      artifacts: { root: captureRoot, activeKeyId: 'connector-test', maximumBytes: 1_048_576 },
    })
    expect(config.connector?.artifacts.keys['connector-test']).toHaveLength(32)
  })

  it('rejects an enabled connector with a partial or inconsistent configuration', async () => {
    await expect(loadProductionHttpConfig(await configurationEnvironment({
      PLACE_CONNECTOR_RUNTIME_ENABLED: 'true',
      PLACE_CONNECTOR_PUBLIC_ORIGIN: 'https://place.example',
    }))).rejects.toThrow('Production HTTP configuration is invalid')
  })
})

import { readFile } from 'node:fs/promises'

import {
  browserAuthEnvironmentName,
  type BrowserAuthApplicationConfig,
} from './application-config.js'
import type { OidcBffConfig } from './oidc-bff.js'
import type { OidcDatabaseConfig } from './oidc-process-runtime.js'
import type { OidcStoreEncryption } from './postgres-oidc-store.js'

export type BrowserAuthEnvironment = Readonly<Record<string, string | undefined>>

export type OidcProviderConfig = Readonly<{
  issuer: string
  clientId: string
  clientSecret: string
  allowInsecureLocalHttp?: boolean
}>

export type LoadedOidcProcessRuntimeConfig = Readonly<{
  database: OidcDatabaseConfig
  encryption: OidcStoreEncryption
  providerConfig: OidcProviderConfig
  bffConfig: OidcBffConfig
  cleanupBatchSize: number
  startupRetry: Readonly<{
    attempts: number
    delayMilliseconds: number
  }>
}>

function configurationError(): Error {
  return new Error('OIDC process runtime configuration is invalid')
}

function required(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
  suffix: string,
): string {
  const value = environment[browserAuthEnvironmentName(application, suffix)]
  if (value === undefined || value === '') throw configurationError()
  return value
}

function positiveInteger(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
  suffix: string,
): number {
  const value = Number(required(environment, application, suffix))
  if (!Number.isInteger(value) || value <= 0) throw configurationError()
  return value
}

function booleanFlag(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
  suffix: string,
): boolean {
  const value = environment[browserAuthEnvironmentName(application, suffix)]
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  throw configurationError()
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' || hostname === '[::1]'
}

function secureOidcUrl(value: string, allowInsecureLocalHttp: boolean): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configurationError()
  }
  if (
    (
      url.protocol !== 'https:' &&
      !(allowInsecureLocalHttp && url.protocol === 'http:' && isLocalHost(url.hostname))
    ) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw configurationError()
  }
  return value
}

async function secret(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
  suffix: string,
): Promise<string> {
  let content: string
  try {
    content = await readFile(required(environment, application, suffix), 'utf8')
  } catch {
    throw configurationError()
  }
  const value = content.endsWith('\n')
    ? content.slice(0, -1).replace(/\r$/, '')
    : content
  if (value === '' || value.includes('\n') || value.includes('\r')) {
    throw configurationError()
  }
  return value
}

function encryptionKey(value: unknown): Readonly<{ id: string; value: Uint8Array }> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    !('value' in value) ||
    typeof value.id !== 'string' ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(value.id) ||
    typeof value.value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.value)
  ) {
    throw configurationError()
  }
  const bytes = Buffer.from(value.value, 'base64url')
  if (bytes.byteLength !== 32 || bytes.toString('base64url') !== value.value) {
    throw configurationError()
  }
  return { id: value.id, value: new Uint8Array(bytes) }
}

function parseEncryption(value: string): OidcStoreEncryption {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw configurationError()
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('activeKeyId' in parsed) ||
    !('keys' in parsed) ||
    typeof parsed.activeKeyId !== 'string' ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length === 0
  ) {
    throw configurationError()
  }
  const keys = parsed.keys.map(encryptionKey)
  if (new Set(keys.map((key) => key.id)).size !== keys.length) throw configurationError()
  const activeKey = keys.find((key) => key.id === parsed.activeKeyId)
  if (activeKey === undefined) throw configurationError()
  return {
    activeKey,
    decryptionKeys: keys.filter((key) => key.id !== parsed.activeKeyId),
  }
}

export async function loadOidcProcessRuntimeConfig(
  environment: BrowserAuthEnvironment,
  application: BrowserAuthApplicationConfig,
): Promise<LoadedOidcProcessRuntimeConfig> {
  const allowInsecureLocalHttp = booleanFlag(
    environment,
    application,
    'OIDC_ALLOW_INSECURE_LOCAL_HTTP',
  )
  const [connectionString, clientSecret, encryptionKeyring] = await Promise.all([
    secret(environment, application, 'DATABASE_URL_FILE'),
    secret(environment, application, 'OIDC_CLIENT_SECRET_FILE'),
    secret(environment, application, 'OIDC_ENCRYPTION_KEYRING_FILE'),
  ])
  const cleanupBatchSize = positiveInteger(
    environment,
    application,
    'OIDC_CLEANUP_BATCH_SIZE',
  )
  if (cleanupBatchSize > 1_000) throw configurationError()
  const startupRetry = {
    attempts: positiveInteger(environment, application, 'OIDC_STARTUP_RETRY_ATTEMPTS'),
    delayMilliseconds: positiveInteger(
      environment,
      application,
      'OIDC_STARTUP_RETRY_DELAY_MILLISECONDS',
    ),
  }
  if (
    startupRetry.attempts > 300 ||
    startupRetry.delayMilliseconds > 60_000 ||
    startupRetry.attempts * startupRetry.delayMilliseconds > 300_000
  ) {
    throw configurationError()
  }
  return {
    database: {
      connectionString,
      maxConnections: positiveInteger(
        environment,
        application,
        'OIDC_DATABASE_MAX_CONNECTIONS',
      ),
      idleTimeoutMilliseconds: positiveInteger(
        environment,
        application,
        'OIDC_DATABASE_IDLE_TIMEOUT_MILLISECONDS',
      ),
      connectionTimeoutMilliseconds: positiveInteger(
        environment,
        application,
        'OIDC_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS',
      ),
    },
    encryption: parseEncryption(encryptionKeyring),
    providerConfig: {
      issuer: secureOidcUrl(
        required(environment, application, 'OIDC_ISSUER'),
        allowInsecureLocalHttp,
      ),
      clientId: required(environment, application, 'OIDC_CLIENT_ID'),
      clientSecret,
      ...(allowInsecureLocalHttp ? { allowInsecureLocalHttp: true } : {}),
    },
    bffConfig: {
      callbackUrl: required(environment, application, 'OIDC_CALLBACK_URL'),
      postLoginPath: required(environment, application, 'OIDC_POST_LOGIN_PATH'),
      scopes: required(environment, application, 'OIDC_SCOPES').split(' ').filter(Boolean),
      transactionTtlSeconds: positiveInteger(
        environment,
        application,
        'OIDC_TRANSACTION_TTL_SECONDS',
      ),
      sessionTtlSeconds: positiveInteger(
        environment,
        application,
        'OIDC_SESSION_TTL_SECONDS',
      ),
      ...(allowInsecureLocalHttp ? { allowInsecureLocalHttp: true } : {}),
    },
    cleanupBatchSize,
    startupRetry,
  }
}

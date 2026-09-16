import { createHash, randomBytes } from 'node:crypto'

import { Pool } from 'pg'

import type { BrowserAuthApplicationConfig } from './application-config.js'
import {
  createOidcBff,
  type OidcBffConfig,
  type ReadyOidcProvider,
} from './oidc-bff.js'
import {
  PostgresOidcStore,
  type OidcStoreEncryption,
} from './postgres-oidc-store.js'

export type OidcDatabaseConfig = Readonly<{
  connectionString: string
  maxConnections: number
  idleTimeoutMilliseconds: number
  connectionTimeoutMilliseconds: number
}>

export type OidcProcessRuntimeConfig = Readonly<{
  application: BrowserAuthApplicationConfig
  database: OidcDatabaseConfig
  encryption: OidcStoreEncryption
  bffConfig: OidcBffConfig
  cleanupBatchSize: number
  provider: ReadyOidcProvider
  randomValue?: () => string
  calculatePkceChallenge?: (verifier: string) => Promise<string>
  now?: () => Date
}>

export type OidcProcessRuntime = Awaited<ReturnType<typeof createOidcProcessRuntime>>

function validateDatabaseConfig(config: OidcDatabaseConfig): void {
  let databaseUrl: URL
  try {
    databaseUrl = new URL(config.connectionString)
  } catch {
    throw new Error('OIDC database configuration is invalid')
  }
  const positiveInteger = (value: number) => Number.isInteger(value) && value > 0
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    databaseUrl.username === '' ||
    databaseUrl.password === '' ||
    databaseUrl.hostname === '' ||
    databaseUrl.pathname.length <= 1 ||
    !positiveInteger(config.maxConnections) ||
    !positiveInteger(config.idleTimeoutMilliseconds) ||
    !positiveInteger(config.connectionTimeoutMilliseconds)
  ) {
    throw new Error('OIDC database configuration is invalid')
  }
}

function secureRandomValue(): string {
  return randomBytes(32).toString('base64url')
}

async function calculatePkceChallenge(verifier: string): Promise<string> {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export async function createOidcProcessRuntime(config: OidcProcessRuntimeConfig) {
  validateDatabaseConfig(config.database)
  if (
    !Number.isInteger(config.cleanupBatchSize) ||
    config.cleanupBatchSize <= 0 ||
    config.cleanupBatchSize > 1_000
  ) {
    throw new Error('OIDC cleanup configuration is invalid')
  }
  const now = config.now ?? (() => new Date())
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= pool.end()
    return closePromise
  }

  try {
    await pool.query('SELECT 1')
    const store = new PostgresOidcStore(pool, config.encryption, config.application)
    return {
      ready: async (): Promise<void> => {
        await Promise.all([
          pool.query('SELECT 1'),
          config.provider.ready(),
        ])
      },
      bff: createOidcBff({
        application: config.application,
        config: config.bffConfig,
        provider: config.provider,
        transactionStore: store,
        sessionStore: store,
        randomValue: config.randomValue ?? secureRandomValue,
        calculatePkceChallenge: config.calculatePkceChallenge ?? calculatePkceChallenge,
        now,
      }),
      cleanupExpired: () => store.cleanupExpired(now(), config.cleanupBatchSize),
      close,
    }
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
}

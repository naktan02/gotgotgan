import { createHash, randomBytes } from 'node:crypto'

import { Pool } from 'pg'

import {
  createOidcBff,
  type OidcBffConfig,
  type OidcProvider,
} from './oidc-bff.ts'
import {
  PostgresOidcStore,
  type OidcStoreEncryption,
} from './postgres-oidc-store.ts'

type OidcDatabaseConfig = Readonly<{
  connectionString: string
  maxConnections: number
  idleTimeoutMilliseconds: number
  connectionTimeoutMilliseconds: number
}>

export type OidcProcessRuntimeConfig = Readonly<{
  database: OidcDatabaseConfig
  encryption: OidcStoreEncryption
  bffConfig: OidcBffConfig
  provider: OidcProvider
  randomValue?: () => string
  calculatePkceChallenge?: (verifier: string) => Promise<string>
  now?: () => Date
}>

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
    const store = new PostgresOidcStore(pool, config.encryption)
    return {
      bff: createOidcBff({
        config: config.bffConfig,
        provider: config.provider,
        transactionStore: store,
        sessionStore: store,
        randomValue: config.randomValue ?? secureRandomValue,
        calculatePkceChallenge: config.calculatePkceChallenge ?? calculatePkceChallenge,
        now: config.now ?? (() => new Date()),
      }),
      close,
    }
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
}

import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  createRemoteOidcPrincipalVerifier,
  PostgresAccessStore,
  type OidcPrincipalVerifierConfig,
  type PrincipalVerifier,
} from '../../modules/access/index.js'
import { buildHttpApplication } from './app.js'
import type { ProductionHttpConfig } from './config.js'

type ProductionRuntimeDependencies = Readonly<{
  createPrincipalVerifier?: (config: OidcPrincipalVerifierConfig) => PrincipalVerifier
  nextMembershipId?: () => string
  now?: () => Date
}>

export async function createProductionHttpRuntime(
  config: ProductionHttpConfig,
  dependencies: ProductionRuntimeDependencies = {},
) {
  const principalVerifier = (
    dependencies.createPrincipalVerifier ?? createRemoteOidcPrincipalVerifier
  )(config.authentication.oidc)
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
  let closePromise: Promise<void> | undefined

  try {
    await pool.query('SELECT 1')
    const store = new PostgresAccessStore(pool)
    const application = buildHttpApplication({
      access: {
        principalVerifier,
        membershipDirectory: store,
        auditSink: store,
        onboarding: {
          policy: config.membershipPolicy,
          store,
          nextMembershipId: dependencies.nextMembershipId ?? randomUUID,
        },
        authorityManagement: { store },
        now: dependencies.now ?? (() => new Date()),
      },
      readiness: async () => {
        await pool.query('SELECT 1')
        return true
      },
    })

    const close = (): Promise<void> => {
      closePromise ??= (async () => {
        await application.close()
        await pool.end()
      })()
      return closePromise
    }

    return {
      application,
      listen: () => application.listen(config.listener),
      close,
    }
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
}

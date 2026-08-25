import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  authorizeAndAudit,
  createRemoteOidcPrincipalVerifier,
  PostgresAccessStore,
  resolveAccessSubject,
  UnregisteredPrincipalError,
  type OidcPrincipalVerifierConfig,
  type PrincipalVerifier,
} from '../../modules/access/index.js'
import { PostgresLibraryStore } from '../../modules/library/index.js'
import { PostgresVisitStore } from '../../modules/visits/index.js'
import { PostgresWritingStore } from '../../modules/writing/index.js'
import type { ProductAuthorizer } from '../../platform/http/product-authorization.js'
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
    const now = dependencies.now ?? (() => new Date())
    const productAuthorizer: ProductAuthorizer = async (authorization, permission) => {
      const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? '')?.[1]
      if (token === undefined) return { status: 'authentication-required' }
      let principal
      try {
        principal = await principalVerifier.verify(token)
      } catch {
        return { status: 'authentication-required' }
      }
      try {
        const subject = await resolveAccessSubject(principal, store)
        const decision = await authorizeAndAudit({ subject, request: { permission }, auditSink: store, now })
        return decision.allowed && subject.kind === 'member'
          ? { status: 'authorized', memberId: subject.membership.id }
          : { status: 'access-denied' }
      } catch (error) {
        if (error instanceof UnregisteredPrincipalError) return { status: 'access-denied' }
        throw error
      }
    }
    const libraryStore = new PostgresLibraryStore(pool)
    const visitStore = new PostgresVisitStore(pool)
    const writingStore = new PostgresWritingStore(pool)
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
        now,
      },
      library: { authorizer: productAuthorizer, store: libraryStore, now },
      visits: { authorizer: productAuthorizer, store: visitStore, now },
      writing: { authorizer: productAuthorizer, store: writingStore, now },
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

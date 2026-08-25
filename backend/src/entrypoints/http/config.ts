import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import {
  readAuthRuntimeConfig,
  type AuthRuntimeConfig,
  type MembershipOnboardingPolicy,
} from '../../modules/access/index.js'

const httpRuntimeSchema = z.object({
  PLACE_HTTP_HOST: z.string().min(1),
  PLACE_HTTP_PORT: z.coerce.number().int().min(1).max(65_535),
})

const httpProcessModeSchema = z.object({
  PLACE_HTTP_RUNTIME_MODE: z.enum(['source-only', 'production']),
})

export type HttpRuntimeConfig = Readonly<{
  host: string
  port: number
}>

export type ProductionHttpConfig = Readonly<{
  listener: HttpRuntimeConfig
  database: Readonly<{
    connectionString: string
    maxConnections: number
    idleTimeoutMilliseconds: number
    connectionTimeoutMilliseconds: number
  }>
  authentication: Extract<AuthRuntimeConfig, { mode: 'oidc' }>
  membershipPolicy: MembershipOnboardingPolicy
}>

const membershipPolicySchema = z
  .object({
    schemaVersion: z.literal('place-membership-policy.v1'),
    requiredConsents: z
      .array(
        z
          .object({
            document: z.string().trim().min(1).max(128),
            version: z.string().trim().min(1).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(32)
      .refine(
        (consents) =>
          new Set(
            consents.map(
              (consent) =>
                `${consent.document.length}:${consent.document}${consent.version.length}:${consent.version}`,
            ),
          ).size === consents.length,
      ),
    initialUserGrade: z.string().trim().min(1).max(128),
    initialProductTier: z.string().trim().min(1).max(128),
  })
  .strict()

const productionEnvironmentSchema = z.object({
  PLACE_HTTP_RUNTIME_MODE: z.literal('production'),
  PLACE_DATABASE_URL_FILE: z.string().min(1),
  PLACE_DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100),
  PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(600_000),
  PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(60_000),
  PLACE_MEMBERSHIP_POLICY_FILE: z.string().min(1),
})

function configurationError(): Error {
  return new Error('Production HTTP configuration is invalid')
}

async function readOneLineFile(path: string): Promise<string> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
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

function databaseConnectionString(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configurationError()
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username === '' ||
    url.password === '' ||
    url.hostname === '' ||
    url.pathname.length <= 1 ||
    url.hash !== ''
  ) {
    throw configurationError()
  }
  return value
}

export function readHttpRuntimeConfig(environment: NodeJS.ProcessEnv): HttpRuntimeConfig {
  const parsed = httpRuntimeSchema.parse(environment)
  return { host: parsed.PLACE_HTTP_HOST, port: parsed.PLACE_HTTP_PORT }
}

export function readHttpProcessMode(
  environment: NodeJS.ProcessEnv,
): 'source-only' | 'production' {
  return httpProcessModeSchema.parse(environment).PLACE_HTTP_RUNTIME_MODE
}

export async function loadProductionHttpConfig(
  environment: NodeJS.ProcessEnv,
): Promise<ProductionHttpConfig> {
  try {
    const values = productionEnvironmentSchema.parse(environment)
    const authentication = readAuthRuntimeConfig(environment)
    if (authentication.mode !== 'oidc') throw configurationError()
    const [databaseUrl, membershipPolicyJson] = await Promise.all([
      readOneLineFile(values.PLACE_DATABASE_URL_FILE),
      readOneLineFile(values.PLACE_MEMBERSHIP_POLICY_FILE),
    ])
    const policyDocument: unknown = JSON.parse(membershipPolicyJson)
    const policy = membershipPolicySchema.parse(policyDocument)
    return {
      listener: readHttpRuntimeConfig(environment),
      database: {
        connectionString: databaseConnectionString(databaseUrl),
        maxConnections: values.PLACE_DATABASE_MAX_CONNECTIONS,
        idleTimeoutMilliseconds: values.PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS,
        connectionTimeoutMilliseconds:
          values.PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS,
      },
      authentication,
      membershipPolicy: {
        requiredConsents: policy.requiredConsents,
        initialUserGrade: policy.initialUserGrade,
        initialProductTier: policy.initialProductTier,
      },
    }
  } catch {
    throw configurationError()
  }
}

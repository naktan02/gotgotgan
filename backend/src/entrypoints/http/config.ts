import { readFile } from 'node:fs/promises'

import { z } from 'zod'
import { connectorPublicOriginSchema } from '@place/contracts/connector'

import {
  readAuthRuntimeConfig,
  type AuthRuntimeConfig,
  type MembershipOnboardingPolicy,
} from '../../modules/access/index.js'
import type {
  GoogleOfficialPlacesConfig,
  KakaoOfficialSearchConfig,
  NaverOfficialSearchConfig,
} from '../../modules/providers/index.js'
import {
  loadCaptureArtifactConfig,
  type CaptureArtifactConfig,
} from '../../platform/config/capture-artifacts.js'

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
  providers?: Readonly<{
    naver?: NaverOfficialSearchConfig
    kakao?: KakaoOfficialSearchConfig
    google?: GoogleOfficialPlacesConfig
  }>
  connector?: Readonly<{
    publicOrigin: string
    grantTtlMilliseconds: number
    captureRetentionMilliseconds: number
    limits: Readonly<{
      maximumItems: number
      maximumBytes: number
      maximumBatches: number
      maximumBatchBytes: number
    }>
    artifacts: CaptureArtifactConfig
  }>
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
  PLACE_CONNECTOR_RUNTIME_ENABLED: z.enum(['true', 'false']),
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

function providerUrl(value: string, requireTrailingSlash: boolean = false): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configurationError()
  }
  if (
    url.protocol !== 'https:' || url.username !== '' || url.password !== '' ||
    url.search !== '' || url.hash !== '' ||
    (requireTrailingSlash && !url.pathname.endsWith('/'))
  ) throw configurationError()
  return url
}

function providerGroup(
  environment: NodeJS.ProcessEnv,
  keys: readonly string[],
): Readonly<Record<string, string>> | undefined {
  const present = keys.filter((key) => environment[key] !== undefined)
  if (present.length === 0) return undefined
  if (present.length !== keys.length) throw configurationError()
  return Object.fromEntries(keys.map((key) => {
    const value = environment[key]
    if (value === undefined || value.trim() === '') throw configurationError()
    return [key, value]
  }))
}

function providerTimeout(value: string): number {
  const parsed = z.coerce.number().int().min(100).max(30_000).safeParse(value)
  if (!parsed.success) throw configurationError()
  return parsed.data
}

const connectorEnvironmentSchema = z.object({
  PLACE_CONNECTOR_PUBLIC_ORIGIN: connectorPublicOriginSchema,
  PLACE_CONNECTOR_GRANT_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600),
  PLACE_CONNECTOR_CAPTURE_RETENTION_SECONDS: z.coerce.number().int().min(3_600).max(2_592_000),
  PLACE_CONNECTOR_MAXIMUM_ITEMS: z.coerce.number().int().min(1).max(100_000),
  PLACE_CONNECTOR_MAXIMUM_BYTES: z.coerce.number().int().min(1_024).max(134_217_728),
  PLACE_CONNECTOR_MAXIMUM_BATCHES: z.coerce.number().int().min(1).max(1_000),
  PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES: z.coerce.number().int().min(1_024).max(4_194_304),
  PLACE_CAPTURE_ROOT: z.string().min(1),
  PLACE_CAPTURE_KEYRING_FILE: z.string().min(1),
  PLACE_CAPTURE_MAXIMUM_BYTES: z.coerce.number().int().min(1).max(104_857_600),
})

async function loadConnectorConfig(environment: NodeJS.ProcessEnv) {
  const values = connectorEnvironmentSchema.parse(environment)
  if (
    values.PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES > values.PLACE_CONNECTOR_MAXIMUM_BYTES ||
    values.PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES > values.PLACE_CAPTURE_MAXIMUM_BYTES
  ) throw configurationError()
  return {
    publicOrigin: values.PLACE_CONNECTOR_PUBLIC_ORIGIN,
    grantTtlMilliseconds: values.PLACE_CONNECTOR_GRANT_TTL_SECONDS * 1_000,
    captureRetentionMilliseconds: values.PLACE_CONNECTOR_CAPTURE_RETENTION_SECONDS * 1_000,
    limits: {
      maximumItems: values.PLACE_CONNECTOR_MAXIMUM_ITEMS,
      maximumBytes: values.PLACE_CONNECTOR_MAXIMUM_BYTES,
      maximumBatches: values.PLACE_CONNECTOR_MAXIMUM_BATCHES,
      maximumBatchBytes: values.PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES,
    },
    artifacts: await loadCaptureArtifactConfig({
      root: values.PLACE_CAPTURE_ROOT,
      keyringFile: values.PLACE_CAPTURE_KEYRING_FILE,
      maximumBytes: values.PLACE_CAPTURE_MAXIMUM_BYTES,
    }),
  }
}

export async function loadOfficialProviderConfig(environment: NodeJS.ProcessEnv) {
  const naverValues = providerGroup(environment, [
    'PLACE_NAVER_SEARCH_ENDPOINT',
    'PLACE_NAVER_CLIENT_ID_FILE',
    'PLACE_NAVER_CLIENT_SECRET_FILE',
    'PLACE_NAVER_TIMEOUT_MILLISECONDS',
  ])
  const kakaoValues = providerGroup(environment, [
    'PLACE_KAKAO_SEARCH_ENDPOINT',
    'PLACE_KAKAO_REST_API_KEY_FILE',
    'PLACE_KAKAO_TIMEOUT_MILLISECONDS',
  ])
  const googleValues = providerGroup(environment, [
    'PLACE_GOOGLE_PLACES_BASE_URL',
    'PLACE_GOOGLE_PLACES_API_KEY_FILE',
    'PLACE_GOOGLE_TIMEOUT_MILLISECONDS',
  ])
  const [naverCredentials, kakaoKey, googleKey] = await Promise.all([
    naverValues === undefined ? undefined : Promise.all([
      readOneLineFile(naverValues.PLACE_NAVER_CLIENT_ID_FILE!),
      readOneLineFile(naverValues.PLACE_NAVER_CLIENT_SECRET_FILE!),
    ]),
    kakaoValues === undefined
      ? undefined
      : readOneLineFile(kakaoValues.PLACE_KAKAO_REST_API_KEY_FILE!),
    googleValues === undefined
      ? undefined
      : readOneLineFile(googleValues.PLACE_GOOGLE_PLACES_API_KEY_FILE!),
  ])
  const providers = {
    ...(naverValues === undefined || naverCredentials === undefined ? {} : {
      naver: {
        endpoint: providerUrl(naverValues.PLACE_NAVER_SEARCH_ENDPOINT!),
        clientId: naverCredentials[0],
        clientSecret: naverCredentials[1],
        timeoutMilliseconds: providerTimeout(naverValues.PLACE_NAVER_TIMEOUT_MILLISECONDS!),
      },
    }),
    ...(kakaoValues === undefined || kakaoKey === undefined ? {} : {
      kakao: {
        endpoint: providerUrl(kakaoValues.PLACE_KAKAO_SEARCH_ENDPOINT!),
        restApiKey: kakaoKey,
        timeoutMilliseconds: providerTimeout(kakaoValues.PLACE_KAKAO_TIMEOUT_MILLISECONDS!),
      },
    }),
    ...(googleValues === undefined || googleKey === undefined ? {} : {
      google: {
        baseUrl: providerUrl(googleValues.PLACE_GOOGLE_PLACES_BASE_URL!, true),
        apiKey: googleKey,
        timeoutMilliseconds: providerTimeout(googleValues.PLACE_GOOGLE_TIMEOUT_MILLISECONDS!),
      },
    }),
  }
  return Object.keys(providers).length === 0 ? undefined : providers
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
    const [databaseUrl, membershipPolicyJson, providers, connector] = await Promise.all([
      readOneLineFile(values.PLACE_DATABASE_URL_FILE),
      readOneLineFile(values.PLACE_MEMBERSHIP_POLICY_FILE),
      loadOfficialProviderConfig(environment),
      values.PLACE_CONNECTOR_RUNTIME_ENABLED === 'true'
        ? loadConnectorConfig(environment)
        : undefined,
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
      ...(providers === undefined ? {} : { providers }),
      ...(connector === undefined ? {} : { connector }),
    }
  } catch {
    throw configurationError()
  }
}

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')

function configurationError(message) {
  return new Error(`Local runtime configuration is invalid: ${message}`)
}

function exactLocalHttpOrigin(name, value) {
  if (value === undefined || value === '') throw configurationError(`${name} is required`)
  let url
  try {
    url = new URL(value)
  } catch {
    throw configurationError(`${name} must be an origin`)
  }
  const localHost = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (
    value !== url.origin || url.protocol !== 'http:' || !localHost ||
    url.username !== '' || url.password !== '' || url.hash !== ''
  ) throw configurationError(`${name} must be an exact local HTTP origin`)
  return url
}

function oneLine(value) {
  return value.endsWith('\n') ? value.slice(0, -1).replace(/\r$/, '') : value
}

async function writeSecretOnce(file, value) {
  try {
    const existing = oneLine(await readFile(file, 'utf8'))
    if (existing === '' || existing.includes('\n') || existing.includes('\r')) {
      throw configurationError(`${path.basename(file)} is malformed`)
    }
    return existing
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeFile(file, `${value}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return value
}

function randomSecret() {
  return randomBytes(32).toString('base64url')
}

function databaseUrl(role, password) {
  const url = new URL('postgresql://postgres:5432/place')
  url.username = role
  url.password = password
  return url.href
}

function hostPath(file) {
  return path.resolve(file).replaceAll('\\', '/')
}

const publicOrigin = exactLocalHttpOrigin(
  'PLACE_LOCAL_PUBLIC_ORIGIN',
  process.env.PLACE_LOCAL_PUBLIC_ORIGIN,
)
const identityOrigin = exactLocalHttpOrigin(
  'PLACE_LOCAL_IDENTITY_ORIGIN',
  process.env.PLACE_LOCAL_IDENTITY_ORIGIN,
)
const webPublishedPort = publicOrigin.port === '' ? 80 : Number(publicOrigin.port)
const backendPublishedPort = Number(
  process.env.PLACE_LOCAL_BACKEND_PUBLISHED_PORT ?? webPublishedPort + 1,
)
if (
  !Number.isInteger(webPublishedPort) || webPublishedPort < 1 || webPublishedPort > 65_535 ||
  !Number.isInteger(backendPublishedPort) || backendPublishedPort < 1 ||
  backendPublishedPort > 65_535 || backendPublishedPort === webPublishedPort
) throw configurationError('published ports are invalid')

const runtimeRoot = path.resolve(
  process.env.PLACE_LOCAL_RUNTIME_ROOT ?? path.join(repositoryRoot, '.runtime', 'local'),
)
const secretRoot = path.join(runtimeRoot, 'secrets')
const configRoot = path.join(runtimeRoot, 'config')
await Promise.all([
  mkdir(secretRoot, { recursive: true }),
  mkdir(configRoot, { recursive: true }),
])

const files = {
  administratorPassword: path.join(secretRoot, 'place_postgres_admin_password'),
  administratorUrl: path.join(secretRoot, 'place_postgres_admin_database_url'),
  migrationPassword: path.join(secretRoot, 'place_migration_database_password'),
  migrationUrl: path.join(secretRoot, 'place_migration_database_url'),
  runtimePassword: path.join(secretRoot, 'place_database_password'),
  runtimeUrl: path.join(secretRoot, 'place_database_url'),
  oidcClientSecret: path.join(secretRoot, 'place_oidc_client_secret'),
  oidcKeyring: path.join(secretRoot, 'place_oidc_encryption_keyring'),
  captureKeyring: path.join(secretRoot, 'place_capture_keyring'),
  membershipPolicy: path.join(configRoot, 'place_membership_policy.json'),
}

const administratorPassword = await writeSecretOnce(
  files.administratorPassword,
  randomSecret(),
)
const migrationPassword = await writeSecretOnce(files.migrationPassword, randomSecret())
const runtimePassword = await writeSecretOnce(files.runtimePassword, randomSecret())
await Promise.all([
  writeSecretOnce(files.administratorUrl, databaseUrl('place_admin', administratorPassword)),
  writeSecretOnce(files.migrationUrl, databaseUrl('place_owner', migrationPassword)),
  writeSecretOnce(files.runtimeUrl, databaseUrl('place_app', runtimePassword)),
  writeSecretOnce(files.oidcKeyring, JSON.stringify({
    activeKeyId: 'local-v1',
    keys: [{ id: 'local-v1', value: randomSecret() }],
  })),
  writeSecretOnce(files.captureKeyring, JSON.stringify({
    schemaVersion: 'place-capture-keyring.v1',
    activeKeyId: 'local-v1',
    keys: [{ id: 'local-v1', material: randomSecret() }],
  })),
  writeSecretOnce(files.membershipPolicy, JSON.stringify({
    schemaVersion: 'place-membership-policy.v1',
    requiredConsents: [
      { document: 'terms-of-service', version: 'local-v1' },
      { document: 'privacy-policy', version: 'local-v1' },
    ],
    initialUserGrade: 'newcomer',
    initialProductTier: 'free',
  })),
])

const clientId = process.env.PLACE_LOCAL_OIDC_CLIENT_ID
const composeEnvironment = path.join(runtimeRoot, 'compose.env')
const databaseEnvironment = path.join(runtimeRoot, 'database.env')
const databaseValues = {
  PLACE_WEB_IMAGE: 'place-web-local',
  PLACE_BACKEND_IMAGE: 'place-backend-local',
  PLACE_WEB_HOST: '0.0.0.0',
  PLACE_WEB_PORT: '3000',
  PLACE_WEB_PUBLISHED_PORT: String(webPublishedPort),
  PLACE_HTTP_HOST: '0.0.0.0',
  PLACE_HTTP_PORT: '3001',
  PLACE_HTTP_PUBLISHED_PORT: String(backendPublishedPort),
  PLACE_DATA_NETWORK: 'place-data-local',
  PLACE_POSTGRES_DATA_VOLUME: 'place-postgres-data-local',
  PLACE_POSTGRES_ADMIN_USER: 'place_admin',
  PLACE_POSTGRES_ADMIN_PASSWORD_FILE: hostPath(files.administratorPassword),
  PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE: hostPath(files.administratorUrl),
  PLACE_MIGRATION_DATABASE_URL_FILE: hostPath(files.migrationUrl),
  PLACE_MIGRATION_DATABASE_PASSWORD_FILE: hostPath(files.migrationPassword),
  PLACE_DATABASE_PASSWORD_FILE: hostPath(files.runtimePassword),
}
await writeFile(
  databaseEnvironment,
  `${Object.entries(databaseValues).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
  { encoding: 'utf8', mode: 0o600 },
)
let state = 'identity-client-required'
if (clientId !== undefined && clientId !== '') {
  if (!/^[A-Za-z0-9._~-]{8,512}$/.test(clientId)) {
    throw configurationError('PLACE_LOCAL_OIDC_CLIENT_ID is malformed')
  }
  try {
    const clientSecret = oneLine(await readFile(files.oidcClientSecret, 'utf8'))
    if (clientSecret === '' || clientSecret.includes('\n') || clientSecret.includes('\r')) {
      throw configurationError('OIDC client secret is malformed')
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw configurationError('OIDC client secret has not been delivered')
    }
    throw error
  }
  const values = {
    ...databaseValues,
    PLACE_HTTP_RUNTIME_MODE: 'production',
    PLACE_DATABASE_MAX_CONNECTIONS: '8',
    PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '30000',
    PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '5000',
    PLACE_WORKER_DATABASE_MAX_CONNECTIONS: '2',
    PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '30000',
    PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '5000',
    PLACE_OIDC_DATABASE_MAX_CONNECTIONS: '4',
    PLACE_OIDC_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '30000',
    PLACE_OIDC_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '5000',
    PLACE_OIDC_ISSUER: identityOrigin.origin,
    PLACE_OIDC_CLIENT_ID: clientId,
    PLACE_OIDC_AUDIENCE: clientId,
    PLACE_OIDC_CALLBACK_URL: `${publicOrigin.origin}/api/auth/oidc/callback`,
    PLACE_OIDC_POST_LOGIN_PATH: '/',
    PLACE_OIDC_SCOPES: 'openid profile offline_access',
    PLACE_OIDC_JWKS_URI: `${identityOrigin.origin}/oauth/v2/keys`,
    PLACE_OIDC_TRANSACTION_TTL_SECONDS: '300',
    PLACE_OIDC_SESSION_TTL_SECONDS: '86400',
    PLACE_OIDC_CLEANUP_BATCH_SIZE: '250',
    PLACE_OIDC_CLEANUP_INTERVAL_SECONDS: '300',
    PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS: '5000',
    PLACE_IMPORT_BACKEND_TIMEOUT_MILLISECONDS: '15000',
    PLACE_CONNECTOR_BACKEND_TIMEOUT_MILLISECONDS: '30000',
    PLACE_BACKEND_ORIGIN: 'http://backend:3001',
    PLACE_CONNECTOR_PUBLIC_ORIGIN: publicOrigin.origin,
    PLACE_CONNECTOR_GRANT_TTL_SECONDS: '300',
    PLACE_CONNECTOR_CAPTURE_RETENTION_SECONDS: '604800',
    PLACE_CONNECTOR_MAXIMUM_ITEMS: '100000',
    PLACE_CONNECTOR_MAXIMUM_BYTES: '134217728',
    PLACE_CONNECTOR_MAXIMUM_BATCHES: '1000',
    PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES: '4194304',
    PLACE_CAPTURE_MAXIMUM_BYTES: '4194304',
    PLACE_CAPTURE_SWEEP_BATCH_SIZE: '100',
    PLACE_CAPTURE_VOLUME: 'place-captures-local',
    PLACE_DATABASE_URL_FILE: hostPath(files.runtimeUrl),
    PLACE_OIDC_CLIENT_SECRET_FILE: hostPath(files.oidcClientSecret),
    PLACE_OIDC_ENCRYPTION_KEYRING_FILE: hostPath(files.oidcKeyring),
    PLACE_CAPTURE_KEYRING_FILE: hostPath(files.captureKeyring),
    PLACE_MEMBERSHIP_POLICY_FILE: hostPath(files.membershipPolicy),
  }
  await writeFile(
    composeEnvironment,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  state = 'ready'
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 'place-local-runtime-preparation.v1',
  state,
  publicOrigin: publicOrigin.origin,
  identityOrigin: identityOrigin.origin,
  runtimeRoot: hostPath(runtimeRoot),
})}\n`)

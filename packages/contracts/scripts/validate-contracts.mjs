import { readFile } from 'node:fs/promises'

const targets = [
  new URL('../http/openapi.v1.json', import.meta.url),
  new URL('../family-navigation/family-navigation.v1.consumer.schema.json', import.meta.url),
  new URL('../fixtures/family-navigation.not-integrated.v1.json', import.meta.url),
  new URL('../fixtures/family-navigation.active.test.v1.json', import.meta.url),
  new URL('../../../deploy/identity/oidc-client.json', import.meta.url),
  new URL('../../../deploy/database-runtime.json', import.meta.url),
  new URL('../../../deploy/application-runtime.json', import.meta.url),
  new URL('../membership/membership-policy.v1.schema.json', import.meta.url),
]

const [
  openApi,
  familySchema,
  fixture,
  activeFixture,
  oidcClient,
  databaseRuntime,
  applicationRuntime,
  membershipPolicySchema,
] = await Promise.all(
  targets.map(async (target) => JSON.parse(await readFile(target, 'utf8'))),
)

const failures = []
if (openApi.openapi !== '3.1.0') failures.push('HTTP contract must use OpenAPI 3.1.0')
if (
  membershipPolicySchema.$id !== 'urn:place:membership-policy:v1' ||
  membershipPolicySchema.additionalProperties !== false ||
  membershipPolicySchema.properties?.schemaVersion?.const !==
    'place-membership-policy.v1'
) {
  failures.push('Membership policy contract identity or strictness drifted')
}
if (openApi.paths['/readyz']?.get?.responses?.['503'] === undefined) {
  failures.push('Process readiness must publish an unavailable response')
}
if (familySchema.$id !== 'urn:place:family-navigation:v1:consumer') {
  failures.push('family navigation consumer schema id drifted')
}
if (fixture.contract !== 'family-navigation.v1' || fixture.deliveryState !== 'not-integrated') {
  failures.push('family navigation fixture must remain explicitly not-integrated')
}
if (!Array.isArray(fixture.items) || fixture.items.length !== 0) {
  failures.push('inactive family navigation fixture cannot hard-code services')
}
if (familySchema.properties.items.items.properties.href.pattern !== '^https://') {
  failures.push('family navigation destinations must use public HTTPS URLs')
}
if (activeFixture.deliveryState !== 'active' || activeFixture.items.length < 2) {
  failures.push('active family navigation test fixture must prove a vertically growing list')
}
if (openApi.paths['/v1/me']?.get?.security?.[0]?.placeBearer?.length !== 0) {
  failures.push('GET /v1/me must require the Place bearer security scheme')
}
const onboardingOperation = openApi.paths['/v1/memberships/onboarding']?.post
const onboardingRequest = openApi.components.schemas.MembershipOnboardingRequest
const currentConsentsOperation =
  openApi.paths['/v1/membership-consents/current']?.get
const browserCurrentConsentsOperation =
  openApi.paths['/api/membership-consents/current']?.get
const browserOnboardingOperation =
  openApi.paths['/api/memberships/onboarding']?.post
const authorityOperation =
  openApi.paths['/v1/administration/memberships/{membershipId}/authority-role']?.patch
const authorityRequest = openApi.components.schemas.AuthorityRoleChangeRequest
if (
  onboardingOperation?.operationId !== 'completePlaceMembershipOnboarding' ||
  onboardingOperation.security?.[0]?.placeBearer?.length !== 0 ||
  openApi.paths['/v1/memberships/onboarding']?.get !== undefined
) {
  failures.push('Membership onboarding must remain a bearer-authenticated POST-only operation')
}
if (
  onboardingRequest?.additionalProperties !== false ||
  onboardingRequest?.properties?.authorityRole !== undefined ||
  onboardingRequest?.properties?.userGrade !== undefined ||
  onboardingRequest?.properties?.productTier !== undefined ||
  onboardingRequest?.properties?.principal !== undefined
) {
  failures.push('Membership onboarding cannot accept identity or membership authority fields')
}
if (
  onboardingOperation?.responses?.['409']?.$ref !==
    '#/components/responses/MembershipConsentRequired' ||
  onboardingOperation?.responses?.['503']?.$ref !==
    '#/components/responses/MembershipOnboardingUnavailable'
) {
  failures.push('Membership onboarding must publish stable consent and availability failures')
}
if (
  currentConsentsOperation?.operationId !== 'getCurrentPlaceMembershipConsents' ||
  openApi.paths['/v1/membership-consents/current']?.post !== undefined ||
  currentConsentsOperation.security?.length !== 0
) {
  failures.push('Current membership consents must remain a public GET-only projection')
}
if (
  browserCurrentConsentsOperation?.operationId !==
    'getCurrentPlaceMembershipConsentsForBrowser' ||
  browserCurrentConsentsOperation.security?.length !== 0 ||
  browserOnboardingOperation?.operationId !==
    'completePlaceBrowserMembershipOnboarding' ||
  browserOnboardingOperation.security?.length !== 0 ||
  openApi.paths['/api/memberships/onboarding']?.get !== undefined
) {
  failures.push('Browser membership operations must remain reviewed Web BFF operations')
}
if (
  browserOnboardingOperation?.requestBody?.content?.['application/json']?.schema?.$ref !==
    '#/components/schemas/MembershipOnboardingRequest' ||
  browserOnboardingOperation?.responses?.['503']?.$ref !==
    '#/components/responses/BrowserMembershipUnavailable'
) {
  failures.push(
    'Browser membership onboarding must reuse the strict request and safe unavailable response',
  )
}
if (
  authorityOperation?.operationId !== 'changePlaceMembershipAuthorityRole' ||
  authorityOperation.security?.[0]?.placeBearer?.length !== 0 ||
  openApi.paths['/v1/administration/memberships/{membershipId}/authority-role']?.post !==
    undefined ||
  authorityRequest?.additionalProperties !== false ||
  Object.keys(authorityRequest?.properties ?? {}).join(',') !== 'nextRole'
) {
  failures.push(
    'Authority-role management must remain a strict bearer-authenticated PATCH',
  )
}
if (
  openApi.paths['/api/auth/oidc/start']?.get?.operationId !== 'startPlaceBrowserLogin' ||
  openApi.paths['/api/auth/oidc/callback']?.get?.operationId !==
    'completePlaceBrowserLogin'
) {
  failures.push('Browser OIDC start and callback must remain GET-only reviewed operations')
}
if (
  openApi.paths['/api/auth/logout']?.post?.operationId !== 'endPlaceBrowserSession' ||
  openApi.paths['/api/auth/logout']?.get !== undefined
) {
  failures.push('Browser logout must remain a POST-only reviewed operation')
}
for (const path of [
  '/api/auth/oidc/start',
  '/api/auth/oidc/callback',
  '/api/auth/logout',
]) {
  const operation = openApi.paths[path]?.get ?? openApi.paths[path]?.post
  if (
    operation?.responses?.['503']?.$ref !==
    '#/components/responses/BrowserAuthUnavailable'
  ) {
    failures.push(`${path} must expose the stable browser-auth unavailable response`)
  }
}
if (
  oidcClient.serviceId !== 'place' ||
  oidcClient.applicationType !== 'web' ||
  oidcClient.authMethod !== 'basic'
) {
  failures.push('Place browser login must remain a confidential web OIDC client')
}
if (
  oidcClient.redirectUris[0] !== '${PLACE_PUBLIC_ORIGIN}/api/auth/oidc/callback' ||
  oidcClient.additionalOrigins.length !== 0
) {
  failures.push('Place OIDC redirects must use the injected public origin and expose no browser origin')
}
if (
  oidcClient.assertRolesInAccessToken !== false ||
  oidcClient.assertRolesInIdToken !== false
) {
  failures.push('Identity tokens cannot assert Place-owned roles')
}
if (
  databaseRuntime.schemaVersion !== 'place-database-runtime.v1' ||
  databaseRuntime.deliveryState !== 'source-only' ||
  databaseRuntime.topology !== 'place-owned-physical-postgis'
) {
  failures.push('Place database runtime must remain an inactive Place-owned physical PostGIS declaration')
}
if (
  databaseRuntime.platform !== 'linux/amd64' ||
  !/^docker\.io\/postgis\/postgis@sha256:[0-9a-f]{64}$/.test(databaseRuntime.image)
) {
  failures.push('Place PostGIS image must be an exact linux/amd64 digest')
}
if (
  databaseRuntime.database !== 'place' ||
  databaseRuntime.roles.administrator === databaseRuntime.roles.migration ||
  databaseRuntime.roles.administrator === databaseRuntime.roles.runtime ||
  databaseRuntime.roles.migration === databaseRuntime.roles.runtime
) {
  failures.push('Place database administrator, migration, and runtime roles must remain distinct')
}
if (
  databaseRuntime.extensions.length !== 1 ||
  databaseRuntime.extensions[0] !== 'postgis' ||
  databaseRuntime.backup.unit !== 'database' ||
  databaseRuntime.backup.isolatedRestoreRequired !== true
) {
  failures.push('Place database runtime must require PostGIS and isolated database restore')
}
if (
  applicationRuntime.schemaVersion !== 'place-application-runtime.v1' ||
  applicationRuntime.deliveryState !== 'source-only' ||
  applicationRuntime.publicProcess !== 'web'
) {
  failures.push('Place application runtime must remain a source-only Web-fronted declaration')
}
if (
  applicationRuntime.processes?.web?.healthPath !== '/healthz' ||
  applicationRuntime.processes?.web?.readinessPath !== '/readyz' ||
  applicationRuntime.processes?.backend?.healthPath !== '/healthz' ||
  applicationRuntime.processes?.backend?.readinessPath !== '/readyz' ||
  applicationRuntime.processes?.backend?.exposure !== 'internal' ||
  applicationRuntime.processes?.worker?.exposure !== 'internal'
) {
  failures.push('Place process health, readiness, and exposure ownership drifted')
}
if (
  applicationRuntime.connections?.browserToBackend !== 'forbidden' ||
  applicationRuntime.connections?.webToBackend !== 'server-to-server' ||
  applicationRuntime.connections?.crossProjectDatabase !== 'forbidden'
) {
  failures.push('Place application connections must preserve browser and database isolation')
}
const databaseSecretFileEnvironments = [
  databaseRuntime.configuration.administratorPasswordFileEnvironment,
  databaseRuntime.configuration.administratorDatabaseUrlFileEnvironment,
  databaseRuntime.configuration.migrationPasswordFileEnvironment,
  databaseRuntime.configuration.runtimePasswordFileEnvironment,
  databaseRuntime.configuration.migrationDatabaseUrlFileEnvironment,
  databaseRuntime.configuration.runtimeDatabaseUrlFileEnvironment,
]
if (
  databaseSecretFileEnvironments.some(
    (name) => typeof name !== 'string' || !/^PLACE_[A-Z0-9_]+_FILE$/.test(name),
  ) ||
  new Set(databaseSecretFileEnvironments).size !== databaseSecretFileEnvironments.length
) {
  failures.push('Every Place database authority must use a distinct deployment-owned secret file')
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Contract scaffolds are valid.\n')

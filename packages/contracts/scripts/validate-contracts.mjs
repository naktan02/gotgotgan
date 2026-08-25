import { readFile } from 'node:fs/promises'

const targets = [
  new URL('../http/openapi.v1.json', import.meta.url),
  new URL('../family-navigation/family-navigation.v1.consumer.schema.json', import.meta.url),
  new URL('../fixtures/family-navigation.not-integrated.v1.json', import.meta.url),
  new URL('../fixtures/family-navigation.active.test.v1.json', import.meta.url),
  new URL('../../../deploy/identity/oidc-client.json', import.meta.url),
]

const [openApi, familySchema, fixture, activeFixture, oidcClient] = await Promise.all(
  targets.map(async (target) => JSON.parse(await readFile(target, 'utf8'))),
)

const failures = []
if (openApi.openapi !== '3.1.0') failures.push('HTTP contract must use OpenAPI 3.1.0')
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

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Contract scaffolds are valid.\n')

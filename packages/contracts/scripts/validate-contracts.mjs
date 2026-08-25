import { readFile } from 'node:fs/promises'

const targets = [
  new URL('../http/openapi.v1.json', import.meta.url),
  new URL('../family-navigation/family-navigation.v1.consumer.schema.json', import.meta.url),
  new URL('../fixtures/family-navigation.not-integrated.v1.json', import.meta.url),
]

const [openApi, familySchema, fixture] = await Promise.all(
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

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Contract scaffolds are valid.\n')

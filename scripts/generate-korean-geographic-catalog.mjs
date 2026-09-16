import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

// Reviewed GeoNames country extract. Updating the source requires a new checksum + coverage review.
const sourceUrl = 'https://download.geonames.org/export/dump/KR.zip'
const sourceSha256 = '779f04b1fca93aa724da5e740e3a6b282065158805c06a3b0bae71b16e7594ac'
const maxBytes = 8 * 1024 * 1024

function countryText(zip) {
  assert.equal(createHash('sha256').update(zip).digest('hex'), sourceSha256, 'GeoNames source checksum changed')
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'Invalid zip directory')
  let offset = zip.readUInt32LE(end + 16)
  for (let index = 0; index < zip.readUInt16LE(end + 10); index += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50)
    const nameLength = zip.readUInt16LE(offset + 28)
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name === 'KR.txt') {
      assert.equal(zip.readUInt16LE(offset + 10), 8, 'Unsupported zip compression')
      const start = zip.readUInt32LE(offset + 42)
      assert.equal(zip.readUInt32LE(start), 0x04034b50)
      const body = start + 30 + zip.readUInt16LE(start + 26) + zip.readUInt16LE(start + 28)
      return inflateRawSync(zip.subarray(body, body + zip.readUInt32LE(offset + 20)),
        { maxOutputLength: 40 * 1024 * 1024 }).toString('utf8')
    }
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
  }
  throw new Error('KR.txt missing from source')
}

const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000), redirect: 'error' })
assert.equal(response.status, 200)
assert.ok(Number(response.headers.get('content-length')) <= maxBytes)
const chunks = []
let size = 0
for await (const chunk of response.body) {
  size += chunk.length
  assert.ok(size <= maxBytes, 'Geographic source exceeds bound')
  chunks.push(chunk)
}
const raw = countryText(Buffer.concat(chunks))
const korean = (names) => names.filter((name) => /^[가-힣\d ·-]+$/u.test(name) && /[가-힣]/u.test(name))
const rows = raw.split('\n').filter(Boolean).map((line) => {
  const field = line.split('\t')
  const names = [...new Set([field[1], field[2], ...korean(field[3].split(','))])]
  const localized = korean(names).sort((left, right) => right.length - left.length || left.localeCompare(right, 'ko'))
  return { id: field[0], name: localized[0] ?? field[1], names, code: field[7],
    latitude: Number(field[4]), longitude: Number(field[5]), admin1: field[10], admin2: field[11] }
}).filter((row) => /^ADM[1-4]$/u.test(row.code) ||
  (['PPL', 'PPLX'].includes(row.code) && korean(row.names).some((name) => /(?:동|읍|면)$/u.test(name))))
const byAdmin1 = new Map(rows.filter((row) => row.code === 'ADM1').map((row) => [row.admin1, row]))
const byAdmin2 = new Map(rows.filter((row) => row.code === 'ADM2').map((row) => [row.admin1 + ':' + row.admin2, row]))
const destinations = rows.map((row) => {
  const parents = [row.code === 'ADM1' ? undefined : byAdmin1.get(row.admin1),
    /^ADM[12]$/u.test(row.code) ? undefined : byAdmin2.get(row.admin1 + ':' + row.admin2)].filter(Boolean)
  const contextNames = parents.flatMap((parent) => korean(parent.names))
  const names = [...new Set([...row.names, ...contextNames.flatMap((parent) => korean(row.names).map((name) => parent + ' ' + name))])]
  assert.ok(Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
  return { key: 'geonames:' + row.id,
    kind: row.code === 'ADM1' ? 'administrative-area' : row.code === 'ADM2' ? 'locality' : 'neighborhood',
    name: row.name, names, countryCode: 'KR', contextLabel: parents.map((parent) => parent.name).join(' · '),
    location: { latitude: row.latitude, longitude: row.longitude }, bounds: null }
}).sort((left, right) => left.key.localeCompare(right.key))
const coverage = Object.fromEntries([...new Set(rows.map((row) => row.code))].sort()
  .map((code) => [code, rows.filter((row) => row.code === code).length]))
const metadata = { generator: 'scripts/generate-korean-geographic-catalog.mjs', sourceUrl, sourceSha256,
  retrievedAt: '2026-09-06', attribution: 'GeoNames', attributionUrl: 'https://www.geonames.org/',
  license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  scope: 'Representative geographic points; not administrative boundaries or complete address coverage.', coverage }
const output = '{\n  "metadata": ' + JSON.stringify(metadata) + ',\n  "destinations": [\n' +
  destinations.map((row) => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n'
const destination = new URL('../backend/src/modules/areas/adapters/geographic-catalog/korea-reference-data.generated.json', import.meta.url)
if (process.argv.includes('--check')) assert.equal(await readFile(destination, 'utf8'), output, 'Generated reference is stale')
else await writeFile(destination, output)
console.log(JSON.stringify({ rows: destinations.length, coverage, sourceSha256 }))

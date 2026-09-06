import assert from 'node:assert/strict'
import test from 'node:test'
import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const id = (index) => `01992d20-4000-7000-8000-${String(index).padStart(12, '0')}`
const world = { west: -180, south: -85, east: 180, north: 85 }
const count = (features) => features.reduce((sum, feature) => sum + (feature.kind === 'place' ? 1 : feature.count), 0)

test('v3 catalog SQL keeps mixed points, bounded coincident choices, selected ownership scope and complete large coverage', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-catalog-map-v3')
  try {
    const search = await import('../../dist/modules/search/index.js')
    const contracts = await import('@place/contracts/search')
    const project = search.createCatalogPlaceMapSearchV3({ source: new search.PostgresCatalogMapSearchV3(database.pool),
      vocabulary: { listAreas: async () => [], listTaxonomies: async () => [] } })
    const input = { query: '', excludedTokenIds: [], viewport: world, zoom: 5, maxFeatures: 384 }
    await database.pool.query(`INSERT INTO search.place_documents
      (place_id, source_version, display_name, search_text, location, taxonomy_keys, evidence_status, projected_at)
      SELECT ('01992d20-4000-7000-8000-' || lpad(i::text,12,'0'))::uuid, 1, '좌표 장소 ' || i, '좌표 장소',
        ST_SetSRID(ST_MakePoint(CASE WHEN i <= 45 THEN 127 ELSE 129 END, CASE WHEN i <= 45 THEN 37.5 ELSE 35.2 END),4326),
        '{}'::text[], 'unverified', now() FROM generate_series(1,46) AS i`)
    let result = await project(input)
    contracts.catalogPlaceMapResponseV3Schema.parse(result)
    assert.equal(result.features.length, 2, 'distant points are not forced into a viewport grid')
    assert.equal(count(result.features), 46)
    const cluster = result.features.find((feature) => feature.kind === 'cluster')
    assert.equal(cluster.count, 45)
    assert.equal(cluster.coincidentPreview.places.length, 20)
    assert.equal(cluster.coincidentPreview.remainingCount, 25)
    result = await project({ ...input, selectedPlaceId: id(35) })
    assert.equal(result.features[0].placeId, id(35))
    assert.equal(count(result.features), 46)
    assert.equal(result.features.find((feature) => feature.kind === 'cluster').count, 44)
    const absent = await project({ ...input, query: '없음', selectedPlaceId: id(35) })
    assert.equal(absent.features.length, 0, 'selection never bypasses active search scope')
    await database.pool.query(`INSERT INTO search.place_documents
      (place_id, source_version, display_name, search_text, location, taxonomy_keys, evidence_status, projected_at)
      SELECT ('01992d20-4000-7000-8000-' || lpad(i::text,12,'0'))::uuid, 1, '대량 장소 ' || i, '대량 장소',
        ST_SetSRID(ST_MakePoint(-179 + (i % 3580)::float8 / 10, -70 + (i % 1400)::float8 / 10),4326),
        '{}'::text[], 'unverified', now() FROM generate_series(1000,10999) AS i`)
    result = await project({ ...input, zoom: 18.5, selectedPlaceId: id(35) })
    contracts.catalogPlaceMapResponseV3Schema.parse(result)
    assert(result.features.length <= 384)
    assert.equal(result.coverage.matchingPlaceCount, 10_046)
    assert.equal(count(result.features), 10_046)
    assert.equal((await project({ ...input, maxFeatures: 1, selectedPlaceId: id(35) })).features.length, 1)
    const legacy = await new search.PostgresCatalogMapSearch(database.pool).projectCatalogMap({
      query: '', areaReferences: [], taxonomyReferenceGroups: [], viewport: world, zoom: 1, maxFeatures: 384,
    })
    assert.equal(legacy.mode, 'clusters')
    assert(legacy.features.every((feature) => feature.kind === 'cluster'))
    await database.pool.query(`INSERT INTO search.place_documents
      (place_id, source_version, display_name, search_text, location, taxonomy_keys, evidence_status, projected_at)
      VALUES ($1,1,'극점 북','극점',ST_SetSRID(ST_MakePoint(-180,85.05112878),4326),'{}'::text[],'unverified',now()),
        ($2,1,'극점 남','극점',ST_SetSRID(ST_MakePoint(180,-85.05112878),4326),'{}'::text[],'unverified',now())`,
    [id(11000), id(11001)])
    const polar = await project({ ...input, query: '극점', viewport: { ...world, south: -85.051129, north: 85.051129 },
      zoom: 18.5, maxFeatures: 1, selectedPlaceId: id(11000) })
    contracts.catalogPlaceMapResponseV3Schema.parse(polar)
    assert.equal(polar.features.length, 1, 'polar roundoff must not create forever-separated negative and positive cells')
    assert.equal(count(polar.features), 2)
    await database.pool.query('UPDATE search.place_documents SET location=ST_SetSRID(ST_MakePoint(0,85.05112878),4326) WHERE place_id=ANY($1::uuid[])',
      [[id(11000), id(11001)]])
    const coincidentPolar = await project({ ...input, query: '극점', viewport: { ...world, north: 85.051129 } })
    contracts.catalogPlaceMapResponseV3Schema.parse(coincidentPolar)
    assert.equal(coincidentPolar.features[0].coincidentPreview.places.length, 2, 'padding remains inside the allowed polar viewport')
  } finally { await database.close() }
})

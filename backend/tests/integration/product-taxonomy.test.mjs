import assert from 'node:assert/strict'
import test from 'node:test'
import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

test('owner product taxonomy seed is atomic, replayable and never rewrites existing meaning', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-product-taxonomy-test')
  const owner = database.administratorClient
  try {
    const { seedProductTaxonomy, listCurrentTaxonomy, PostgresTaxonomyStore } = await import('../../dist/modules/taxonomy/index.js')
    await owner.query('SET ROLE place_owner')
    await owner.query(`INSERT INTO taxonomy.node_versions
      (node_key, version, parent_key, label, kind, active, effective_at) VALUES
      ('services.public', 1, NULL, '기존 다른 의미', 'category', true, '2020-01-01'),
      ('custom.preserved', 1, NULL, '사용자 정의 운영 분류', 'category', true, '2020-01-01')`)
    await assert.rejects(seedProductTaxonomy(owner), { name: 'TaxonomyVersionConflictError' })
    assert.equal((await owner.query('SELECT count(*)::int AS count FROM taxonomy.node_versions')).rows[0].count, 2)
    // Only this disposable fixture removes its deliberate conflicting row.
    await owner.query("DELETE FROM taxonomy.node_versions WHERE node_key = 'services.public'")
    await owner.query(`INSERT INTO taxonomy.node_versions
      (node_key, version, parent_key, label, kind, active, effective_at) VALUES
      ('food', 2, NULL, '음식점', 'category', true, '2020-01-01')`)
    const first = await seedProductTaxonomy(owner)
    assert.equal(first.published, 44)
    assert.equal(first.replayed, 1)
    assert.deepEqual(await seedProductTaxonomy(owner), { published: 0, replayed: 45 })
    const store = new PostgresTaxonomyStore(database.pool)
    assert.deepEqual(await store.readVersions([]), [])
    assert.deepEqual(await store.readVersions([{ key: 'food', version: 1 }]), [])
    const exactVersions = await store.readVersions([{ key: 'food', version: 2 }, { key: 'food', version: 2 }])
    assert.equal(exactVersions.length, 1)
    assert.equal(exactVersions[0].version, 2)
    await assert.rejects(store.readVersions(Array.from({ length: 257 }, () => ({ key: 'food', version: 2 }))), { name: 'InvalidTaxonomyNodeError' })
    await assert.rejects(store.readVersions([{ key: 'food', version: -1 }]), { name: 'InvalidTaxonomyNodeError' })
    const { nodes } = await listCurrentTaxonomy(store)
    assert.equal(nodes.length, 46)
    assert.equal(nodes.find((node) => node.key === 'food').version, 2)
    assert.equal(nodes.find((node) => node.key === 'custom.preserved').label, '사용자 정의 운영 분류')
    const byKey = new Map(nodes.map((node) => [node.key, node]))
    const lineage = []
    let current = byKey.get('food.noodle.ramen.shoyu')
    while (current) { lineage.push(current.label); current = byKey.get(current.parentKey) }
    assert.deepEqual(lineage, ['쇼유라멘', '라멘', '일식', '음식점'])
    for (const node of nodes) {
      assert.ok(node.parentKey === null || byKey.has(node.parentKey))
      const seen = new Set()
      let ancestor = node
      while (ancestor) {
        assert.ok(!seen.has(ancestor.key), `cycle: ${node.key}`)
        seen.add(ancestor.key)
        ancestor = byKey.get(ancestor.parentKey)
      }
    }
    const original = await owner.query("SELECT effective_at FROM taxonomy.node_versions WHERE node_key = 'food'")
    assert.equal(original.rows.length, 1)
    assert.equal(original.rows[0].effective_at.toISOString(), '2020-01-01T00:00:00.000Z')
    const memberState = await owner.query('SELECT count(*)::int AS count FROM library.collections')
    assert.equal(memberState.rows[0].count, 0)
  } finally { await database.close() }
})

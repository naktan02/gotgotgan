import assert from 'node:assert/strict'
import test from 'node:test'

import {
  memberA,
  places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

const tagId = '01992d20-3000-7000-8000-000000000602'

test('saved-place and tag reads retain their bounded query plans', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-library-query-plans')
  try {
    const { command, database } = fixture
    await command('01992d20-3000-7000-8000-000000000604', memberA, {
      kind: 'create-tag', tagId, name: '데이트',
    })
    await command('01992d20-3000-7000-8000-000000000612', memberA, {
      kind: 'tag-place', tagId, placeId: places[1],
    })
    await database.pool.query(`
      WITH generated AS (
        SELECT
          (substr(md5(sequence::text), 1, 8) || '-' || substr(md5(sequence::text), 9, 4) || '-4' ||
           substr(md5(sequence::text), 14, 3) || '-8' || substr(md5(sequence::text), 18, 3) || '-' ||
           substr(md5(sequence::text), 21, 12))::uuid AS id,
          sequence
        FROM generate_series(1000, 5999) AS sequence
      ), inserted AS (
        INSERT INTO places.canonical_places (id)
        SELECT id FROM generated ON CONFLICT (id) DO NOTHING RETURNING id
      )
      INSERT INTO library.place_preferences (
        membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at
      )
      SELECT $1::uuid, id, true, false, NULL, '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z'::timestamptz + (sequence || ' seconds')::interval
      FROM generated
      ON CONFLICT (membership_id, canonical_place_id) DO NOTHING
    `, [memberA])
    await database.pool.query('ANALYZE library.place_preferences')
    await database.pool.query('SET enable_seqscan = off')
    const plan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT canonical_place_id FROM library.place_preferences
      WHERE membership_id = $1::uuid AND saved
      ORDER BY updated_at DESC, canonical_place_id ASC LIMIT 20
    `, [memberA])
    assert.match(JSON.stringify(plan.rows[0]), /library_place_preferences_saved_updated/)
    const tagPlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT canonical_place_id FROM library.place_tags
      WHERE membership_id = $1::uuid AND tag_id = $2::uuid
      ORDER BY canonical_place_id LIMIT 20
    `, [memberA, tagId])
    assert.match(JSON.stringify(tagPlan.rows[0]), /library_place_tags_member_tag_place/)
  } finally {
    await fixture.close()
  }
})

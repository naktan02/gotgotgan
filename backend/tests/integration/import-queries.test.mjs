import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const ids = {
  memberA: '01992d22-1000-7000-8000-000000000101',
  memberB: '01992d22-1000-7000-8000-000000000102',
  connectionA: '01992d22-1000-7000-8000-000000000201',
  connectionB: '01992d22-1000-7000-8000-000000000202',
  batchNewest: '01992d22-1000-7000-8000-000000000301',
  batchMiddle: '01992d22-1000-7000-8000-000000000302',
  batchOldest: '01992d22-1000-7000-8000-000000000303',
  batchOtherMember: '01992d22-1000-7000-8000-000000000304',
  capture: '01992d22-1000-7000-8000-000000000401',
  firstItem: '01992d22-1000-7000-8000-000000000501',
  secondItem: '01992d22-1000-7000-8000-000000000502',
  thirdItem: '01992d22-1000-7000-8000-000000000503',
}

const at = '2026-08-28T08:00:00.000Z'

test('Import queries are bounded, member-isolated, cursor-safe, and index-backed', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-import-queries')
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const queries = new ingestion.PostgresImportQueries(database.pool)
    const management = new ingestion.PostgresImportManagement(database.pool)

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
        ($1,'https://identity.example.test','imports-a','active','member','standard','unclassified',$3,$3),
        ($2,'https://identity.example.test','imports-b','active','member','standard','unclassified',$3,$3)`,
      [ids.memberA, ids.memberB, at],
    )
    await database.pool.query(
      `INSERT INTO ingestion.provider_connections
        (id, member_id, provider_key, label, status, profile_reference,
         last_verified_at, created_at, updated_at)
       VALUES
        ($1,$3,'naver','회원 A NAVER','ready','profile:imports-a',$5,$5,$5),
        ($2,$4,'naver','회원 B NAVER','ready','profile:imports-b',$5,$5,$5)`,
      [ids.connectionA, ids.connectionB, ids.memberA, ids.memberB, at],
    )
    await database.pool.query(
      `INSERT INTO ingestion.import_batches
        (id, member_id, connection_id, provider_key, idempotency_key,
         request_fingerprint, state, failure_code, failure_retryable,
         discovered_count, ready_count, review_required_count, enriching_count,
         applied_count, skipped_count, failed_count, created_at, updated_at)
       VALUES
        ($1,$5,$6,'naver','01992d22-1000-7000-8000-000000000601',repeat('a',64),
         'completed',NULL,NULL,3,1,1,0,1,0,0,'2026-08-28T07:00:00Z','2026-08-28T07:30:00Z'),
        ($2,$5,$6,'naver','01992d22-1000-7000-8000-000000000602',repeat('b',64),
         'failed','internal-failure',true,0,0,0,0,0,0,0,
         '2026-08-28T06:00:00Z','2026-08-28T06:30:00Z'),
        ($3,$5,$6,'naver','01992d22-1000-7000-8000-000000000603',repeat('c',64),
         'queued',NULL,NULL,0,0,0,0,0,0,0,'2026-08-28T05:00:00Z','2026-08-28T05:00:00Z'),
        ($4,$7,$8,'naver','01992d22-1000-7000-8000-000000000604',repeat('d',64),
         'completed',NULL,NULL,0,0,0,0,0,0,0,
         '2026-08-28T08:00:00Z','2026-08-28T08:00:00Z')`,
      [
        ids.batchNewest, ids.batchMiddle, ids.batchOldest, ids.batchOtherMember,
        ids.memberA, ids.connectionA, ids.memberB, ids.connectionB,
      ],
    )

    const firstPage = await queries.listBatches({ memberId: ids.memberA, state: 'all', limit: 2 })
    assert.deepEqual(firstPage.items.map((batch) => batch.batchId), [ids.batchNewest, ids.batchMiddle])
    assert.equal(firstPage.items[1].failure.code, 'internal-failure')
    assert.ok(firstPage.nextCursor)
    assert.doesNotMatch(JSON.stringify(firstPage), /idempotency|fingerprint|profile:|imports-b/i)

    const secondPage = await queries.listBatches({
      memberId: ids.memberA, state: 'all', limit: 2, cursor: firstPage.nextCursor,
    })
    assert.deepEqual(secondPage.items.map((batch) => batch.batchId), [ids.batchOldest])
    assert.equal(secondPage.nextCursor, undefined)
    const completed = await queries.listBatches({
      memberId: ids.memberA, state: 'completed', limit: 20,
    })
    assert.deepEqual(completed.items.map((batch) => batch.batchId), [ids.batchNewest])
    await assert.rejects(
      queries.listBatches({
        memberId: ids.memberA, state: 'completed', limit: 20, cursor: firstPage.nextCursor,
      }),
      ingestion.InvalidImportCursorError,
    )
    await assert.rejects(
      queries.listBatches({ memberId: ids.memberA, state: 'all', limit: 51 }),
      ingestion.InvalidImportQueryError,
    )

    await database.pool.query(
      `INSERT INTO ingestion.import_capture_artifacts
        (id, batch_id, artifact_reference, payload_checksum, parser_version,
         acquisition_kind, observed_at, retained_until, created_at)
       VALUES ($1,$2,'capture:import-query-fixture',repeat('e',64),'fixture.v1',
               'manual-capture',$3,'2026-09-28T08:00:00Z',$3)`,
      [ids.capture, ids.batchNewest, at],
    )
    await database.pool.query(
      `INSERT INTO ingestion.import_items
        (id, batch_id, capture_id, source_item_key, source_item_id, provider_place_id,
         source_list_id, source_list_position, source_position, list_name, display_name,
         address, category_label, status, review_reasons, observation_id, candidate_id,
         decision_id, proposed_place_id, created_at, updated_at)
       VALUES
        ($2,$1,$5,'list-b:item-b','item-b','provider-b','list-b',1,0,
         '부산','세 번째 장소',NULL,NULL,'ready','{}',$6,$7,$8,$9,$10,$10),
        ($3,$1,$5,'list-a:item-b','item-b','provider-a2','list-a',0,1,
         '서울','두 번째 장소',NULL,NULL,'needs-review',ARRAY['possible-duplicate'],$7,$8,$9,$6,$10,$10),
        ($4,$1,$5,'list-a:item-a','item-a',NULL,'list-a',0,0,
         '서울','첫 번째 장소',NULL,NULL,'applied','{}',$8,$9,$6,$7,$10,$10)`,
      [
        ids.batchNewest, ids.thirdItem, ids.secondItem, ids.firstItem, ids.capture,
        '01992d22-1000-7000-8000-000000000701',
        '01992d22-1000-7000-8000-000000000702',
        '01992d22-1000-7000-8000-000000000703',
        '01992d22-1000-7000-8000-000000000704', at,
      ],
    )

    const detailFirst = await queries.getBatch({
      memberId: ids.memberA, batchId: ids.batchNewest, limit: 2,
    })
    assert.deepEqual(detailFirst.items.map((item) => item.itemId), [ids.firstItem, ids.secondItem])
    assert.deepEqual(detailFirst.items.map((item) => item.detailStatus), ['unavailable', 'pending'])
    assert.ok(detailFirst.nextCursor)
    const detailSecond = await queries.getBatch({
      memberId: ids.memberA, batchId: ids.batchNewest, limit: 2,
      cursor: detailFirst.nextCursor,
    })
    assert.deepEqual(detailSecond.items.map((item) => item.itemId), [ids.thirdItem])
    assert.equal(detailSecond.nextCursor, undefined)
    assert.equal(await queries.getBatch({
      memberId: ids.memberB, batchId: ids.batchNewest, limit: 200,
    }), undefined)
    await assert.rejects(
      queries.getBatch({
        memberId: ids.memberA, batchId: ids.batchMiddle, limit: 20,
        cursor: detailFirst.nextCursor,
      }),
      ingestion.InvalidImportCursorError,
    )

    assert.equal((await management.cancelImport(
      ids.memberB, ids.batchOldest, '2026-08-28T09:00:00Z',
    )), undefined)
    assert.equal((await management.cancelImport(
      ids.memberA, ids.batchOldest, '2026-08-28T09:00:00Z',
    )).state, 'cancelled')
    assert.equal((await management.resumeImport(
      ids.memberA, ids.batchOldest, '2026-08-28T09:01:00Z',
    )).state, 'queued')

    await database.pool.query(`
      WITH generated AS (
        SELECT md5('batch-' || sequence)::uuid AS id,
               md5('idempotency-' || sequence)::uuid AS idempotency_key,
               sequence
        FROM generate_series(1000, 5999) AS sequence
      )
      INSERT INTO ingestion.import_batches
        (id, member_id, connection_id, provider_key, idempotency_key,
         request_fingerprint, state, created_at, updated_at)
      SELECT id, $1::uuid, $2::uuid, 'naver', idempotency_key,
             repeat(md5(sequence::text), 2),
             CASE WHEN sequence % 2 = 0 THEN 'completed' ELSE 'queued' END,
             '2026-01-01T00:00:00Z'::timestamptz + (sequence || ' seconds')::interval,
             '2026-08-28T08:00:00Z'
      FROM generated
      ON CONFLICT (id) DO NOTHING
    `, [ids.memberA, ids.connectionA])
    await database.pool.query(`
      WITH generated AS (
        SELECT md5('item-' || sequence)::uuid AS id, sequence
        FROM generate_series(1000, 5999) AS sequence
      )
      INSERT INTO ingestion.import_items
        (id, batch_id, capture_id, source_item_key, source_item_id,
         source_list_id, source_list_position, source_position, list_name, display_name,
         status, review_reasons, observation_id, candidate_id, decision_id,
         proposed_place_id, created_at, updated_at)
      SELECT id, $1::uuid, $2::uuid, 'bulk:' || sequence, sequence::text,
             'bulk', sequence / 100, sequence % 100, '대량 목록', '장소 ' || sequence,
             'ready', '{}', md5('observation-' || sequence)::uuid,
             md5('candidate-' || sequence)::uuid, md5('decision-' || sequence)::uuid,
             md5('proposed-' || sequence)::uuid, '2026-08-28T08:00:00Z', '2026-08-28T08:00:00Z'
      FROM generated
      ON CONFLICT (id) DO NOTHING
    `, [ids.batchNewest, ids.capture])
    await database.pool.query('ANALYZE ingestion.import_batches')
    await database.pool.query('ANALYZE ingestion.import_items')
    await database.pool.query('SET enable_seqscan = off')

    const allPlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM ingestion.import_batches
      WHERE member_id = $1::uuid
        AND ($2::text = 'all' OR state = $2::text)
      ORDER BY created_at DESC, id ASC LIMIT 20
    `, [ids.memberA, 'all'])
    assert.match(JSON.stringify(allPlan.rows[0]), /import_batches_member/)
    const statePlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM ingestion.import_batches
      WHERE member_id = $1::uuid
        AND ($2::text = 'all' OR state = $2::text)
      ORDER BY created_at DESC, id ASC LIMIT 20
    `, [ids.memberA, 'completed'])
    assert.match(JSON.stringify(statePlan.rows[0]), /import_batches_member_state_created/)
    const itemPlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM ingestion.import_items
      WHERE batch_id = $1::uuid
      ORDER BY source_list_position, source_position, id LIMIT 200
    `, [ids.batchNewest])
    assert.match(JSON.stringify(itemPlan.rows[0]), /import_items_batch_source_order/)
  } finally {
    await database.close()
  }
})

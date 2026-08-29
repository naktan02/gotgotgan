import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d21-1000-7000-8000-000000000101'
const memberB = '01992d21-1000-7000-8000-000000000102'
const placeA = '01992d21-1000-7000-8000-000000000201'
const placeB = '01992d21-1000-7000-8000-000000000202'
const visitA = '01992d21-1000-7000-8000-000000000301'
const visitB = '01992d21-1000-7000-8000-000000000302'
const visitOtherMember = '01992d21-1000-7000-8000-000000000303'
const noteId = '01992d21-1000-7000-8000-000000000401'
const entryId = '01992d21-1000-7000-8000-000000000402'
const otherMemberDocumentId = '01992d21-1000-7000-8000-000000000403'
const publicationId = '01992d21-1000-7000-8000-000000000404'
const at = '2026-08-28T06:00:00.000Z'
const noteCreatedAt = '2026-08-28T05:00:00.000Z'
const noteUpdatedAt = '2026-08-28T05:30:00.000Z'

test('Visit and Writing queries stay bounded, cursor-safe, and member-isolated', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-visit-writing-queries')
  try {
    const visits = await import('../../dist/modules/visits/index.js')
    const writing = await import('../../dist/modules/writing/index.js')
    const visitStore = new visits.PostgresVisitStore(database.pool)
    const visitQueries = new visits.PostgresVisitQueries(database.pool)
    const writingStore = new writing.PostgresWritingStore(database.pool)
    const writingQueries = new writing.PostgresWritingQueries(database.pool)

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
        ($1,'https://identity.example.test','content-a','active','member','standard','unclassified',$3,$3),
        ($2,'https://identity.example.test','content-b','active','member','standard','unclassified',$3,$3)`,
      [memberA, memberB, at],
    )
    await database.pool.query(
      'INSERT INTO places.canonical_places (id) VALUES ($1), ($2)',
      [placeA, placeB],
    )

    for (const record of [
      { id: visitA, memberId: memberA, placeId: placeA, visitedAt: '2026-08-28T05:00:00.000Z' },
      { id: visitB, memberId: memberA, placeId: placeA, visitedAt: '2026-08-28T04:00:00.000Z' },
      { id: visitOtherMember, memberId: memberB, placeId: placeA, visitedAt: '2026-08-28T05:30:00.000Z' },
    ]) {
      await visits.recordVisit({ ...record, recordedAt: at, store: visitStore })
    }

    const visitFirst = await visitQueries.listPlaceVisits({
      memberId: memberA, placeId: placeA, limit: 1,
    })
    assert.deepEqual(visitFirst.items, [{
      visitId: visitA,
      visitedAt: '2026-08-28T05:00:00.000Z',
      recordedAt: at,
    }])
    assert.ok(visitFirst.nextCursor)
    const visitSecond = await visitQueries.listPlaceVisits({
      memberId: memberA, placeId: placeA, limit: 1, cursor: visitFirst.nextCursor,
    })
    assert.deepEqual(visitSecond.items.map((item) => item.visitId), [visitB])
    assert.equal(visitSecond.nextCursor, undefined)
    assert.doesNotMatch(JSON.stringify(visitFirst), /fingerprint|memberId|evidence/)
    await assert.rejects(
      visitQueries.listPlaceVisits({
        memberId: memberA, placeId: placeB, limit: 20, cursor: visitFirst.nextCursor,
      }),
      visits.InvalidVisitCursorError,
    )
    await assert.rejects(
      visitQueries.listPlaceVisits({ memberId: memberA, placeId: placeA, limit: 51 }),
      visits.InvalidVisitQueryError,
    )

    const longBody = '가'.repeat(300)
    const revisedLongBody = `${longBody} 수정`
    const apply = (commandId, memberId, occurredAt, command) => writing.applyWritingCommand({
      commandId, memberId, occurredAt, command, store: writingStore,
    })
    await apply('01992d21-1000-7000-8000-000000000501', memberA, noteCreatedAt, {
      kind: 'create-note', documentId: noteId, body: longBody, placeId: placeA,
      visibility: 'private',
    })
    await apply('01992d21-1000-7000-8000-000000000502', memberA, '2026-08-28T04:00:00.000Z', {
      kind: 'create-entry', documentId: entryId, title: '두 장소', body: '긴 글',
      placeIds: [placeA, placeB], visibility: 'public', publicationId,
    })
    await apply('01992d21-1000-7000-8000-000000000503', memberB, '2026-08-28T06:00:00.000Z', {
      kind: 'create-note', documentId: otherMemberDocumentId, body: '다른 회원',
      placeId: placeA, visibility: 'private',
    })
    await apply('01992d21-1000-7000-8000-000000000504', memberA, noteUpdatedAt, {
      kind: 'update-note', documentId: noteId, expectedVersion: 1,
      body: revisedLongBody, placeId: placeA, visibility: 'private',
    })

    const writingFirst = await writingQueries.list({ memberId: memberA, kind: 'all', limit: 1 })
    assert.equal(writingFirst.items[0].documentId, noteId)
    assert.equal(writingFirst.schemaVersion, 'writing-list.v2')
    assert.equal(writingFirst.items[0].bodyPreview.length, 280)
    assert.equal(writingFirst.items[0].bodyTruncated, true)
    assert.equal(writingFirst.items[0].createdAt, noteCreatedAt)
    assert.equal(writingFirst.items[0].updatedAt, noteUpdatedAt)
    assert.equal('body' in writingFirst.items[0], false)
    assert.ok(writingFirst.nextCursor)
    const writingSecond = await writingQueries.list({
      memberId: memberA, kind: 'all', limit: 1, cursor: writingFirst.nextCursor,
    })
    assert.deepEqual(writingSecond.items.map((item) => item.documentId), [entryId])
    assert.equal(writingSecond.nextCursor, undefined)
    const placeNotes = await writingQueries.list({
      memberId: memberA, kind: 'note', placeId: placeA, limit: 20,
    })
    assert.deepEqual(placeNotes.filter, { kind: 'note', placeId: placeA })
    assert.deepEqual(placeNotes.items.map((item) => item.documentId), [noteId])
    assert.deepEqual((await writingQueries.list({
      memberId: memberA, kind: 'note', placeId: placeB, limit: 20,
    })).items, [])
    assert.deepEqual((await writingQueries.list({
      memberId: memberA, kind: 'entry', placeId: placeB, limit: 20,
    })).items.map((item) => item.documentId), [entryId])
    await assert.rejects(
      writingQueries.list({
        memberId: memberA, kind: 'note', limit: 20, cursor: writingFirst.nextCursor,
      }),
      writing.InvalidWritingCursorError,
    )
    await assert.rejects(
      writingQueries.list({
        memberId: memberA, kind: 'all', placeId: placeA, limit: 20,
        cursor: writingFirst.nextCursor,
      }),
      writing.InvalidWritingCursorError,
    )
    await assert.rejects(
      writingQueries.list({ memberId: memberA, kind: 'all', limit: 0 }),
      writing.InvalidWritingQueryError,
    )

    const detail = await writingQueries.get({ memberId: memberA, documentId: noteId })
    assert.equal(detail.document.body, revisedLongBody)
    assert.equal(detail.document.visibility, 'private')
    assert.equal(detail.document.createdAt, noteCreatedAt)
    assert.equal(detail.document.updatedAt, noteUpdatedAt)
    assert.deepEqual((await database.pool.query(
      `SELECT changed_at FROM writing.document_revisions
       WHERE document_id = $1 ORDER BY version`,
      [noteId],
    )).rows.map((row) => row.changed_at.toISOString()), [noteCreatedAt, noteUpdatedAt])
    assert.equal(
      await writingQueries.get({ memberId: memberB, documentId: noteId }),
      undefined,
    )
    assert.doesNotMatch(JSON.stringify(writingFirst), new RegExp(otherMemberDocumentId))

    await database.pool.query(`
      WITH generated AS (
        SELECT
          (substr(md5(sequence::text), 1, 8) || '-' || substr(md5(sequence::text), 9, 4) || '-4' ||
           substr(md5(sequence::text), 14, 3) || '-8' || substr(md5(sequence::text), 18, 3) || '-' ||
           substr(md5(sequence::text), 21, 12))::uuid AS id,
          sequence
        FROM generate_series(1000, 5999) AS sequence
      )
      INSERT INTO visits.visit_occurrences (
        id, membership_id, canonical_place_id, visited_at, recorded_at, fingerprint
      )
      SELECT id, $1::uuid, $2::uuid,
             '2026-01-01T00:00:00Z'::timestamptz + (sequence || ' seconds')::interval,
             '2026-08-28T06:00:00Z', repeat('a', 64)
      FROM generated
      ON CONFLICT (id) DO NOTHING
    `, [memberA, placeA])
    await database.pool.query(`
      WITH generated AS (
        SELECT
          (substr(md5(('writing-' || sequence)::text), 1, 8) || '-' ||
           substr(md5(('writing-' || sequence)::text), 9, 4) || '-4' ||
           substr(md5(('writing-' || sequence)::text), 14, 3) || '-8' ||
           substr(md5(('writing-' || sequence)::text), 18, 3) || '-' ||
           substr(md5(('writing-' || sequence)::text), 21, 12))::uuid AS id,
          sequence
        FROM generate_series(1000, 5999) AS sequence
      )
      INSERT INTO writing.documents (
        id, owner_membership_id, kind, title, body, visibility, publication_id,
        version, created_at, updated_at
      )
      SELECT id, $1::uuid, 'note', NULL, 'index row', 'private', NULL, 1,
             '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z'::timestamptz + (sequence || ' seconds')::interval
      FROM generated
      ON CONFLICT (id) DO NOTHING
    `, [memberA])
    await database.pool.query('ANALYZE visits.visit_occurrences')
    await database.pool.query('ANALYZE writing.documents')
    await database.pool.query('ANALYZE writing.document_place_links')
    await database.pool.query('SET enable_seqscan = off')
    const visitPlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM visits.visit_occurrences
      WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid
      ORDER BY visited_at DESC, id ASC LIMIT 20
    `, [memberA, placeA])
    assert.match(JSON.stringify(visitPlan.rows[0]), /visit_occurrences_member_place_time/)
    const writingPlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM writing.documents
      WHERE owner_membership_id = $1::uuid
      ORDER BY updated_at DESC, id ASC LIMIT 20
    `, [memberA])
    assert.match(JSON.stringify(writingPlan.rows[0]), /writing_documents_owner_updated/)
    const writingPlacePlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT document_id FROM writing.document_place_links
      WHERE canonical_place_id = $1::uuid
    `, [placeA])
    assert.match(
      JSON.stringify(writingPlacePlan.rows[0]),
      /writing_document_place_links_place_document/,
    )
  } finally {
    await database.close()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d20-4000-7000-8000-000000000101'
const memberB = '01992d20-4000-7000-8000-000000000102'
const memberC = '01992d20-4000-7000-8000-000000000103'
const memberD = '01992d20-4000-7000-8000-000000000104'
const memberReviewer = '01992d20-4000-7000-8000-000000000105'
const at = '2026-08-29T10:00:00.000Z'

test('Public Profiles keep handles stable and list only owner public Collections', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-public-profiles')
  try {
    const profiles = await import('../../dist/modules/profiles/index.js')
    const library = await import('../../dist/modules/library/index.js')
    const store = new profiles.PostgresPublicProfileStore(database.pool)
    const safety = new profiles.PostgresPublicProfileSafetyStore(database.pool)
    const appeals = new profiles.PostgresPublicProfileAppealStore(database.pool)
    const queries = new library.PostgresLibraryQueries(
      database.pool,
      async () => [],
      async () => ({ places: [], unprojectedPlaceCount: 0 }),
    )

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
        ($1,'https://identity.example.test','profile-a','active','member','standard','unclassified',$3,$3),
        ($2,'https://identity.example.test','profile-b','active','member','standard','unclassified',$3,$3),
        ($4,'https://identity.example.test','profile-reviewer','active','reviewer','standard','unclassified',$3,$3)`,
      [memberA, memberB, at, memberReviewer],
    )
    await database.pool.query(
      `INSERT INTO library.collections
        (id, owner_membership_id, name, description, visibility, publication_id, created_at, updated_at)
       VALUES
        ('01992d20-4000-7000-8000-000000000201',$1,'첫 공개 목록',NULL,'public','01992d20-4000-7000-8000-000000000301',$3,'2026-08-29T12:00:00Z'),
        ('01992d20-4000-7000-8000-000000000202',$1,'링크 목록',NULL,'unlisted','01992d20-4000-7000-8000-000000000302',$3,'2026-08-29T11:00:00Z'),
        ('01992d20-4000-7000-8000-000000000203',$1,'두 번째 공개 목록','설명','public','01992d20-4000-7000-8000-000000000303',$3,'2026-08-29T10:00:00Z'),
        ('01992d20-4000-7000-8000-000000000204',$2,'다른 회원 목록',NULL,'public','01992d20-4000-7000-8000-000000000304',$3,'2026-08-29T13:00:00Z')`,
      [memberA, memberB, at],
    )

    await profiles.setPublicProfile({
      commandId: '01992d20-4000-7000-8000-000000000401',
      memberId: memberA,
      command: { handle: 'ramen-log', displayName: '라멘 기록', visibility: 'hidden', expectedUpdatedAt: null },
      occurredAt: at,
      store,
    })
    assert.equal(await store.getPublished('ramen-log'), undefined)
    const hidden = await store.getCurrent(memberA)
    const published = await profiles.setPublicProfile({
      commandId: '01992d20-4000-7000-8000-000000000402',
      memberId: memberA,
      command: {
        handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public',
        expectedUpdatedAt: hidden.updatedAt,
      },
      occurredAt: '2026-08-29T10:00:01.000Z',
      store,
    })
    assert.equal(published.status, 'applied')
    await assert.rejects(
      database.pool.query(
        `UPDATE profiles.public_profiles SET handle = 'changed-log' WHERE membership_id = $1::uuid`,
        [memberA],
      ),
      (error) => error?.code === '42501',
    )

    const first = await profiles.readPublishedProfile({
      handle: 'ramen-log', limit: 1, store,
      collections: (input) => queries.listPublicCollectionsByOwner(input),
    })
    assert.deepEqual(first.collections.map((collection) => collection.name), ['첫 공개 목록'])
    assert.ok(first.nextCursor)
    assert.equal(JSON.stringify(first).includes(memberA), false)
    const second = await profiles.readPublishedProfile({
      handle: 'ramen-log', limit: 1, cursor: first.nextCursor, store,
      collections: (input) => queries.listPublicCollectionsByOwner(input),
    })
    assert.deepEqual(second.collections.map((collection) => collection.name), ['두 번째 공개 목록'])
    assert.equal(second.nextCursor, undefined)

    const report = await profiles.reportPublicProfile({
      reportId: '01992d20-4000-7000-8000-000000000501',
      reporterMemberId: memberB,
      handle: 'ramen-log',
      reason: 'spam',
      occurredAt: '2026-08-29T10:05:00.000Z',
      store: safety,
    })
    assert.equal(report.status, 'recorded')
    assert.equal((await profiles.reportPublicProfile({
      reportId: '01992d20-4000-7000-8000-000000000501',
      reporterMemberId: memberB,
      handle: 'ramen-log',
      reason: 'spam',
      occurredAt: '2026-08-29T10:05:01.000Z',
      store: safety,
    })).status, 'replayed')
    assert.equal((await profiles.reportPublicProfile({
      reportId: '01992d20-4000-7000-8000-000000000502',
      reporterMemberId: memberB,
      handle: 'ramen-log',
      reason: 'privacy',
      occurredAt: '2026-08-29T10:05:02.000Z',
      store: safety,
    })).status, 'already-reported')
    await assert.rejects(
      profiles.reportPublicProfile({
        reportId: '01992d20-4000-7000-8000-000000000503',
        reporterMemberId: memberA,
        handle: 'ramen-log',
        reason: 'spam',
        occurredAt: '2026-08-29T10:05:03.000Z',
        store: safety,
      }),
      profiles.PublicProfileSelfReportError,
    )
    const pending = await profiles.listPendingPublicProfileReports({
      limit: 20,
      now: '2026-08-29T10:05:04.000Z',
      store: safety,
    })
    assert.deepEqual(pending.reports.map((item) => ({ handle: item.handle, reason: item.reason })), [
      { handle: 'ramen-log', reason: 'spam' },
    ])
    assert.equal(JSON.stringify(pending).includes(memberB), false)
    assert.deepEqual(await profiles.readPublicProfileModeration({ handle: 'ramen-log', store: safety }), {
      schemaVersion: 'public-profile-moderation.v1',
      handle: 'ramen-log',
      state: 'allowed',
      reason: null,
      updatedAt: null,
    })

    const withheld = await profiles.moderatePublicProfile({
      decisionId: '01992d20-4000-7000-8000-000000000601',
      actorMemberId: memberReviewer,
      handle: 'ramen-log',
      command: { state: 'withheld', reason: 'spam', expectedUpdatedAt: null },
      occurredAt: '2026-08-29T10:06:00.000Z',
      store: safety,
    })
    assert.equal(withheld.status, 'applied')
    assert.equal(await store.getPublished('ramen-log'), undefined)
    assert.deepEqual((await profiles.listPendingPublicProfileReports({
      limit: 20,
      now: '2026-08-29T10:06:01.000Z',
      store: safety,
    })).reports, [])
    assert.equal((await profiles.moderatePublicProfile({
      decisionId: '01992d20-4000-7000-8000-000000000601',
      actorMemberId: memberReviewer,
      handle: 'ramen-log',
      command: { state: 'withheld', reason: 'spam', expectedUpdatedAt: null },
      occurredAt: '2026-08-29T10:06:01.000Z',
      store: safety,
    })).status, 'replayed')
    await assert.rejects(
      database.pool.query(
        `UPDATE profiles.public_profile_moderation_decisions
            SET reason = 'privacy'
          WHERE decision_id = '01992d20-4000-7000-8000-000000000601'`,
      ),
      (error) => error?.code === '42501',
    )
    const withheldRecord = await profiles.readPublicProfileModeration({
      handle: 'ramen-log', store: safety,
    })
    const ownerNotices = await profiles.listPublicProfileOwnerNotices({
      ownerMemberId: memberA,
      limit: 20,
      store: appeals,
    })
    assert.deepEqual(ownerNotices.notices.map((notice) => ({
      noticeId: notice.noticeId, kind: notice.kind, reason: notice.reason,
    })), [{
      noticeId: '01992d20-4000-7000-8000-000000000601',
      kind: 'withheld',
      reason: 'spam',
    }])
    assert.equal(JSON.stringify(ownerNotices).includes(memberReviewer), false)
    assert.equal((await profiles.acknowledgePublicProfileOwnerNotice({
      ownerMemberId: memberA,
      noticeId: '01992d20-4000-7000-8000-000000000601',
      occurredAt: '2026-08-29T10:06:02.000Z',
      store: appeals,
    })).status, 'acknowledged')

    const firstAppeal = await profiles.submitPublicProfileAppeal({
      appealId: '01992d20-4000-7000-8000-000000000701',
      ownerMemberId: memberA,
      noticeId: '01992d20-4000-7000-8000-000000000601',
      reason: 'mistaken-identity',
      occurredAt: '2026-08-29T10:06:03.000Z',
      store: appeals,
    })
    assert.equal(firstAppeal.status, 'recorded')
    assert.equal((await profiles.submitPublicProfileAppeal({
      appealId: '01992d20-4000-7000-8000-000000000701',
      ownerMemberId: memberA,
      noticeId: '01992d20-4000-7000-8000-000000000601',
      reason: 'mistaken-identity',
      occurredAt: '2026-08-29T10:06:04.000Z',
      store: appeals,
    })).status, 'replayed')
    assert.equal((await profiles.submitPublicProfileAppeal({
      appealId: '01992d20-4000-7000-8000-000000000702',
      ownerMemberId: memberA,
      noticeId: '01992d20-4000-7000-8000-000000000601',
      reason: 'decision-context',
      occurredAt: '2026-08-29T10:06:05.000Z',
      store: appeals,
    })).status, 'already-appealed')
    const appealQueue = await profiles.listPendingPublicProfileAppeals({
      limit: 20,
      store: appeals,
    })
    assert.deepEqual(appealQueue.appeals.map((appeal) => ({
      appealId: appeal.appealId,
      handle: appeal.handle,
      reason: appeal.reason,
      moderationReason: appeal.moderationReason,
    })), [{
      appealId: '01992d20-4000-7000-8000-000000000701',
      handle: 'ramen-log',
      reason: 'mistaken-identity',
      moderationReason: 'spam',
    }])
    assert.equal(JSON.stringify(appealQueue).includes(memberA), false)
    await assert.rejects(
      profiles.moderatePublicProfile({
        decisionId: '01992d20-4000-7000-8000-000000000602',
        actorMemberId: memberReviewer,
        handle: 'ramen-log',
        command: {
          state: 'allowed', reason: 'insufficient-evidence',
          expectedUpdatedAt: withheldRecord.updatedAt,
        },
        occurredAt: '2026-08-29T10:07:00.000Z',
        store: safety,
      }),
      profiles.PublicProfileModerationAppealPendingError,
    )
    assert.equal((await profiles.resolvePublicProfileAppeal({
      resolutionId: '01992d20-4000-7000-8000-000000000801',
      actorMemberId: memberReviewer,
      appealId: '01992d20-4000-7000-8000-000000000701',
      command: { outcome: 'rejected', reason: 'decision-upheld' },
      occurredAt: '2026-08-29T10:07:01.000Z',
      store: appeals,
    })).status, 'applied')
    assert.equal(await store.getPublished('ramen-log'), undefined)
    assert.equal((await profiles.moderatePublicProfile({
      decisionId: '01992d20-4000-7000-8000-000000000603',
      actorMemberId: memberReviewer,
      handle: 'ramen-log',
      command: {
        state: 'withheld', reason: 'privacy',
        expectedUpdatedAt: withheldRecord.updatedAt,
      },
      occurredAt: '2026-08-29T10:08:00.000Z',
      store: safety,
    })).status, 'applied')
    assert.equal((await profiles.submitPublicProfileAppeal({
      appealId: '01992d20-4000-7000-8000-000000000703',
      ownerMemberId: memberA,
      noticeId: '01992d20-4000-7000-8000-000000000603',
      reason: 'issue-corrected',
      occurredAt: '2026-08-29T10:08:01.000Z',
      store: appeals,
    })).status, 'recorded')
    assert.equal((await profiles.resolvePublicProfileAppeal({
      resolutionId: '01992d20-4000-7000-8000-000000000802',
      actorMemberId: memberReviewer,
      appealId: '01992d20-4000-7000-8000-000000000703',
      command: { outcome: 'accepted' },
      occurredAt: '2026-08-29T10:09:00.000Z',
      store: appeals,
    })).status, 'applied')
    assert.equal((await store.getPublished('ramen-log')).handle, 'ramen-log')
    await assert.rejects(
      database.administratorClient.query(
        `INSERT INTO profiles.public_profile_owner_notices (
           notice_id, owner_membership_id, handle, moderation_decision_id,
           appeal_resolution_id, kind, reason, created_at, acknowledged_at
         ) VALUES (
           '01992d20-4000-7000-8000-000000000805', $1::uuid, 'ramen-log',
           '01992d20-4000-7000-8000-000000000802', NULL, 'restored',
           'appeal-accepted', '2026-08-29T10:09:01.000Z'::timestamptz, NULL
         )`,
        [memberA],
      ),
      (error) => error?.code === '23514',
    )
    const firstNoticePage = await profiles.listPublicProfileOwnerNotices({
      ownerMemberId: memberA,
      limit: 1,
      store: appeals,
    })
    assert.ok(firstNoticePage.nextCursor)
    assert.equal(
      Buffer.from(firstNoticePage.nextCursor, 'base64url').toString('utf8').includes(memberA),
      false,
    )
    await assert.rejects(
      profiles.listPublicProfileOwnerNotices({
        ownerMemberId: memberB,
        cursor: firstNoticePage.nextCursor,
        limit: 1,
        store: appeals,
      }),
      profiles.InvalidPublicProfileAppealCursorError,
    )
    assert.equal((await profiles.reportPublicProfile({
      reportId: '01992d20-4000-7000-8000-000000000504',
      reporterMemberId: memberReviewer,
      handle: 'ramen-log',
      reason: 'privacy',
      occurredAt: '2026-08-29T10:10:00.000Z',
      store: safety,
    })).status, 'recorded')
    const restoredRecord = await profiles.readPublicProfileModeration({
      handle: 'ramen-log', store: safety,
    })
    assert.equal((await profiles.moderatePublicProfile({
      decisionId: '01992d20-4000-7000-8000-000000000604',
      actorMemberId: memberReviewer,
      handle: 'ramen-log',
      command: {
        state: 'withheld', reason: 'privacy', expectedUpdatedAt: restoredRecord.updatedAt,
      },
      occurredAt: '2026-08-29T10:11:00.000Z',
      store: safety,
    })).status, 'applied')
    assert.equal((await profiles.submitPublicProfileAppeal({
      appealId: '01992d20-4000-7000-8000-000000000704',
      ownerMemberId: memberA,
      noticeId: '01992d20-4000-7000-8000-000000000604',
      reason: 'decision-context',
      occurredAt: '2026-08-29T10:11:01.000Z',
      store: appeals,
    })).status, 'recorded')

    await assert.rejects(
      queries.listPublicCollectionsByOwner({ ownerMemberId: memberB, limit: 1, cursor: first.nextCursor }),
      library.InvalidLibraryCursorError,
    )
    await assert.rejects(
      profiles.setPublicProfile({
        commandId: '01992d20-4000-7000-8000-000000000403',
        memberId: memberB,
        command: { handle: 'ramen-log', displayName: '다른 사람', visibility: 'public', expectedUpdatedAt: null },
        occurredAt: '2026-08-29T10:00:02.000Z',
        store,
      }),
      profiles.PublicProfileHandleUnavailableError,
    )
    await assert.rejects(
      profiles.setPublicProfile({
        commandId: '01992d20-4000-7000-8000-000000000404',
        memberId: memberA,
        command: {
          handle: 'changed-log', displayName: '라멘 기록', visibility: 'public',
          expectedUpdatedAt: (await store.getCurrent(memberA)).updatedAt,
        },
        occurredAt: '2026-08-29T10:00:03.000Z',
        store,
      }),
      profiles.PublicProfileHandleImmutableError,
    )

    await database.administratorClient.query(
      `DELETE FROM profiles.public_profiles WHERE membership_id = $1::uuid`,
      [memberA],
    )
    assert.equal(await store.getPublished('ramen-log'), undefined)
    const closedReports = await database.administratorClient.query(
      `SELECT reviewed_at
         FROM profiles.public_profile_reports
        WHERE handle = 'ramen-log'`,
    )
    assert.ok(closedReports.rows.length >= 2)
    assert.ok(closedReports.rows.every((row) => row.reviewed_at instanceof Date))
    const supersededAppeal = await database.administratorClient.query(
      `SELECT appeal.status, resolution.outcome, resolution.reason
         FROM profiles.public_profile_appeals appeal
         JOIN profiles.public_profile_appeal_resolutions resolution
           ON resolution.resolution_id = appeal.resolution_id
        WHERE appeal.appeal_id = '01992d20-4000-7000-8000-000000000704'`,
    )
    assert.deepEqual(supersededAppeal.rows[0], {
      status: 'superseded', outcome: 'superseded', reason: 'profile-deleted',
    })
    await assert.rejects(
      database.pool.query(
        `UPDATE profiles.public_profile_appeal_resolutions
            SET reason = 'decision-upheld'
          WHERE resolution_id = '01992d20-4000-7000-8000-000000000802'`,
      ),
      (error) => error?.code === '42501',
    )
    const retired = await database.administratorClient.query(
      `SELECT membership_id, retired_at
         FROM profiles.public_handle_reservations
        WHERE handle = 'ramen-log'`,
    )
    assert.equal(retired.rows[0].membership_id, null)
    assert.ok(retired.rows[0].retired_at instanceof Date)
    await assert.rejects(
      database.pool.query(
        `INSERT INTO profiles.public_handle_reservations
          (handle, membership_id, reserved_at, retired_at)
         VALUES ('squatted-log', NULL, $1::timestamptz, $1::timestamptz)`,
        [at],
      ),
      (error) => error?.code === '23514',
    )

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES ($1,'https://identity.example.test','profile-c','active','member','standard','unclassified',$2,$2)`,
      [memberC, at],
    )
    await assert.rejects(
      profiles.setPublicProfile({
        commandId: '01992d20-4000-7000-8000-000000000405',
        memberId: memberC,
        command: { handle: 'ramen-log', displayName: '새 사람', visibility: 'public', expectedUpdatedAt: null },
        occurredAt: '2026-08-29T10:00:04.000Z',
        store,
      }),
      profiles.PublicProfileHandleUnavailableError,
    )
    await assert.rejects(
      database.administratorClient.query(
        `UPDATE profiles.public_handle_reservations
            SET membership_id = $1::uuid, retired_at = NULL
          WHERE handle = 'ramen-log'`,
        [memberC],
      ),
      (error) => error?.code === '23514',
    )

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES ($1,'https://identity.example.test','profile-d','active','member','standard','unclassified',$2,$2)`,
      [memberD, at],
    )
    await profiles.setPublicProfile({
      commandId: '01992d20-4000-7000-8000-000000000406',
      memberId: memberD,
      command: { handle: 'coffee-log', displayName: '커피 기록', visibility: 'public', expectedUpdatedAt: null },
      occurredAt: '2026-08-29T10:00:05.000Z',
      store,
    })
    await database.administratorClient.query(
      `DELETE FROM access.memberships WHERE id = $1::uuid`,
      [memberD],
    )
    assert.equal(await store.getPublished('coffee-log'), undefined)
    const membershipRetired = await database.administratorClient.query(
      `SELECT membership_id, retired_at
         FROM profiles.public_handle_reservations
        WHERE handle = 'coffee-log'`,
    )
    assert.equal(membershipRetired.rows[0].membership_id, null)
    assert.ok(membershipRetired.rows[0].retired_at instanceof Date)
    assert.ok((await safety.deleteExpiredReports({
      now: '2027-03-01T00:00:00.000Z',
      limit: 100,
    })) >= 2)
  } finally {
    await database.close()
  }
})

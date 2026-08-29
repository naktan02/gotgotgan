import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d20-4000-7000-8000-000000000101'
const memberB = '01992d20-4000-7000-8000-000000000102'
const at = '2026-08-29T10:00:00.000Z'

test('Public Profiles keep handles stable and list only owner public Collections', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-public-profiles')
  try {
    const profiles = await import('../../dist/modules/profiles/index.js')
    const library = await import('../../dist/modules/library/index.js')
    const store = new profiles.PostgresPublicProfileStore(database.pool)
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
        ($2,'https://identity.example.test','profile-b','active','member','standard','unclassified',$3,$3)`,
      [memberA, memberB, at],
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
  } finally {
    await database.close()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const ownerId = '01992d31-0000-7000-8000-000000000001'
const viewerId = '01992d31-0000-7000-8000-000000000002'
const sourceCollectionId = '01992d31-0000-7000-8000-000000000003'
const sourcePublicationId = '01992d31-0000-7000-8000-000000000004'
const placeA = '01992d31-0000-7000-8000-000000000005'
const placeB = '01992d31-0000-7000-8000-000000000006'
const copiedCollectionId = '01992d31-0000-7000-8000-000000000007'
const staleTargetId = '01992d31-0000-7000-8000-000000000008'
const secondCollectionId = '01992d31-0000-7000-8000-000000000009'
const secondPublicationId = '01992d31-0000-7000-8000-000000000010'
const at = '2026-09-03T00:00:00.000Z'
const areaKey = 'area_abcdefghijklmnopqrstuv'

test('public Collection discovery and copy are version-bound and moderation-aware', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-public-discovery')
  try {
    const library = await import('../../dist/modules/library/index.js')
    const search = await import('../../dist/modules/search/index.js')
    const localSearch = new search.PostgresLocalSearch(database.pool)
    const readSummaries = async (placeIds) => (await localSearch.getCatalogPlaceDocuments(placeIds))
      .map((place) => ({
        placeId: place.placeId,
        name: place.name,
        areaLabel: place.area?.label ?? null,
        location: place.location,
        primaryTaxonomy: place.primaryTaxonomy === null
          ? null
          : { key: place.primaryTaxonomy.key, label: place.primaryTaxonomy.label },
        taxonomyKeys: place.taxonomyReferences.map((reference) => reference.key),
        evidence: { status: place.evidenceStatus, projectedAt: place.projectedAt },
      }))
    const discovery = new library.PostgresPublicCollectionDiscovery(database.pool, readSummaries)
    const exchange = new library.PostgresPublishedCollectionExchange(database.pool)

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
        ($1,'https://identity.example.test','discovery-owner','active','member','standard','unclassified',$3,$3),
        ($2,'https://identity.example.test','discovery-viewer','active','member','standard','unclassified',$3,$3)`,
      [ownerId, viewerId, at],
    )
    await database.pool.query(
      `INSERT INTO profiles.public_handle_reservations
         (handle, membership_id, reserved_at, retired_at)
       VALUES ('tokyo-parent',$1::uuid,$2::timestamptz,NULL)`,
      [ownerId, at],
    )
    await database.pool.query(
      `INSERT INTO profiles.public_profiles
         (membership_id, handle, display_name, visibility, created_at, updated_at)
       VALUES ($1::uuid,'tokyo-parent','도쿄 가족','public',$2::timestamptz,$2::timestamptz)`,
      [ownerId, at],
    )
    await database.pool.query(
      'INSERT INTO places.canonical_places (id) VALUES ($1::uuid),($2::uuid)',
      [placeA, placeB],
    )
    await database.pool.query(
      `INSERT INTO search.place_documents (
         place_id, source_version, display_name, area_label, search_text, location,
         primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys,
         evidence_status, projected_at, area_key, area_version, taxonomy_references
       ) VALUES
        ($1::uuid,1,'teamLab Planets TOKYO','도쿄 도요스','teamlab planets tokyo',
         ST_SetSRID(ST_MakePoint(139.7898,35.6491),4326),'tourism.museum','관광지',
         ARRAY['tourism.museum'],'verified',$3::timestamptz,$4,1,
         '[{"key":"tourism.museum","version":1,"kind":"category"}]'::jsonb),
        ($2::uuid,1,'도쿄 국립과학박물관','도쿄 우에노','도쿄 국립과학박물관',
         ST_SetSRID(ST_MakePoint(139.7765,35.7163),4326),'tourism.museum','관광지',
         ARRAY['tourism.museum'],'verified',$3::timestamptz,$4,1,
         '[{"key":"tourism.museum","version":1,"kind":"category"}]'::jsonb)`,
      [placeA, placeB, at, areaKey],
    )
    await database.pool.query(
      `INSERT INTO library.collections (
         id, owner_membership_id, name, description, visibility, publication_id,
         created_at, updated_at, revision
       ) VALUES ($1::uuid,$2::uuid,'도쿄 실내 가족 코스','비 오는 날 아이와 함께',
         'public',$3::uuid,$4::timestamptz,$4::timestamptz,3)`,
      [sourceCollectionId, ownerId, sourcePublicationId, at],
    )
    await database.pool.query(
      `INSERT INTO library.collection_places
         (collection_id, canonical_place_id, position, added_at)
       VALUES ($1::uuid,$2::uuid,3,$4::timestamptz),($1::uuid,$3::uuid,9,$4::timestamptz)`,
      [sourceCollectionId, placeA, placeB, at],
    )
    await database.pool.query(
      `INSERT INTO library.collection_discovery_topics (collection_id, topic_key, label, ordinal)
       VALUES ($1::uuid,'family-trip','아이와 함께',0)`,
      [sourceCollectionId],
    )
    await database.pool.query(
      `INSERT INTO library.collections (
         id, owner_membership_id, name, description, visibility, publication_id,
         created_at, updated_at, revision
       ) VALUES ($1::uuid,$2::uuid,'서울 카페 산책',NULL,'public',$3::uuid,
         $4::timestamptz,$4::timestamptz,1)`,
      [secondCollectionId, ownerId, secondPublicationId, at],
    )

    const page = await discovery.list({
      q: '도쿄', areaKeys: [areaKey], taxonomyKeys: ['tourism.museum'],
      topicKeys: ['family-trip'], sort: 'largest', limit: 1,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].publicationId, sourcePublicationId)
    assert.equal(page.items[0].owner.handle, 'tokyo-parent')
    assert.deepEqual(page.items[0].topics, [{ key: 'family-trip', label: '아이와 함께' }])
    assert.deepEqual(page.items[0].previewPlaces.map((place) => place.placeId), [placeA, placeB])
    assert.equal(page.availableFilters.areas[0].key, areaKey)
    assert.equal(page.availableFilters.taxonomies[0].key, 'tourism.museum')
    assert.equal(page.availableFilters.topics[0].key, 'family-trip')
    const publicationVersion = page.items[0].publicationVersion

    const directoryFirst = await discovery.list({
      q: null, areaKeys: [], taxonomyKeys: [], topicKeys: [], sort: 'recent', limit: 1,
    })
    assert.equal(directoryFirst.items.length, 1)
    assert.ok(directoryFirst.nextCursor)
    const directorySecond = await discovery.list({
      q: null, areaKeys: [], taxonomyKeys: [], topicKeys: [], sort: 'recent', limit: 1,
      cursor: directoryFirst.nextCursor,
    })
    assert.equal(directorySecond.items.length, 1)
    assert.notEqual(directorySecond.items[0].publicationId, directoryFirst.items[0].publicationId)
    await assert.rejects(
      discovery.list({
        q: null, areaKeys: [], taxonomyKeys: [], topicKeys: [], sort: 'name', limit: 1,
        cursor: directoryFirst.nextCursor,
      }),
      (error) => error?.name === 'InvalidLibraryCursorError',
    )

    const firstDetail = await discovery.get({ publicationId: sourcePublicationId, limit: 1 })
    assert.equal(firstDetail.places[0].placeId, placeA)
    assert.ok(firstDetail.nextCursor)
    const secondDetail = await discovery.get({
      publicationId: sourcePublicationId, cursor: firstDetail.nextCursor, limit: 1,
    })
    assert.deepEqual(secondDetail.places.map((place) => place.placeId), [placeB])

    await database.pool.query(
      `UPDATE library.collections SET revision = revision + 1,
         updated_at = updated_at + interval '1 second' WHERE id = $1::uuid`,
      [sourceCollectionId],
    )
    await assert.rejects(
      discovery.get({ publicationId: sourcePublicationId, cursor: firstDetail.nextCursor, limit: 1 }),
      (error) => error?.name === 'InvalidLibraryCursorError',
    )
    const stale = await exchange.copy(library.normalizePublishedCollectionCopy({
      context: {
        operationId: '01992d31-0000-7000-8000-000000000101', memberId: viewerId,
        occurredAt: '2026-09-03T00:00:02.000Z',
      },
      publicationId: sourcePublicationId,
      expectedPublicationVersion: publicationVersion,
      targetCollectionId: staleTargetId,
      targetName: '오래된 복사',
      selection: { kind: 'all' },
    }))
    assert.deepEqual(stale.rejection, { code: 'publication-changed' })

    const refreshed = await discovery.get({ publicationId: sourcePublicationId, limit: 2 })
    const copyCommand = library.normalizePublishedCollectionCopy({
      context: {
        operationId: '01992d31-0000-7000-8000-000000000102', memberId: viewerId,
        occurredAt: '2026-09-03T00:00:03.000Z',
      },
      publicationId: sourcePublicationId,
      expectedPublicationVersion: refreshed.publicationVersion,
      targetCollectionId: copiedCollectionId,
      targetName: '내 도쿄 코스',
      selection: { kind: 'places', placeIds: [placeB] },
    })
    const copied = await exchange.copy(copyCommand)
    assert.equal(copied.status, 'applied')
    assert.deepEqual(copied.value, {
      collectionId: copiedCollectionId,
      version: copied.value.version,
      copiedPlaceCount: 1,
    })
    assert.equal((await exchange.copy(copyCommand)).status, 'replayed')
    const reused = await exchange.copy({ ...copyCommand, targetName: '다른 이름' })
    assert.deepEqual(reused.rejection, { code: 'operation-id-reused' })
    const persisted = await database.pool.query(
      `SELECT collection.visibility, collection.publication_id,
              placed.canonical_place_id, placed.position
       FROM library.collections AS collection
       LEFT JOIN library.collection_places AS placed ON placed.collection_id = collection.id
       WHERE collection.id = $1::uuid`,
      [copiedCollectionId],
    )
    assert.deepEqual(persisted.rows, [{
      visibility: 'private', publication_id: null, canonical_place_id: placeB, position: 0,
    }])
    const provenance = await database.pool.query(
      `SELECT canonical_place_id, source_position
       FROM library.publication_copy_items WHERE operation_id = $1::uuid`,
      [copyCommand.context.operationId],
    )
    assert.deepEqual(provenance.rows, [{ canonical_place_id: placeB, source_position: 9 }])

    await database.pool.query(
      `INSERT INTO profiles.public_profile_moderation_decisions (
         decision_id, handle, actor_membership_id, previous_state, next_state,
         reason, decision_fingerprint, decided_at
       ) VALUES (
         '01992d31-0000-7000-8000-000000000201','tokyo-parent',$1::uuid,
         'allowed','withheld','privacy',repeat('a',64),$2::timestamptz
       )`,
      [viewerId, '2026-09-03T00:00:04.000Z'],
    )
    await database.pool.query(
      `INSERT INTO profiles.public_profile_moderation (
         handle, state, reason, decided_by_membership_id, updated_at, decision_id
       ) VALUES (
         'tokyo-parent','withheld','privacy',$1::uuid,$2::timestamptz,
         '01992d31-0000-7000-8000-000000000201'
       )`,
      [viewerId, '2026-09-03T00:00:04.000Z'],
    )
    assert.equal((await discovery.list({
      q: null, areaKeys: [], taxonomyKeys: [], topicKeys: [], sort: 'recent', limit: 20,
    })).items.length, 0)
    assert.equal(await discovery.get({ publicationId: sourcePublicationId, limit: 20 }), undefined)
    const blocked = await exchange.copy(library.normalizePublishedCollectionCopy({
      context: {
        operationId: '01992d31-0000-7000-8000-000000000103', memberId: viewerId,
        occurredAt: '2026-09-03T00:00:05.000Z',
      },
      publicationId: sourcePublicationId,
      expectedPublicationVersion: refreshed.publicationVersion,
      targetCollectionId: staleTargetId,
      targetName: '차단된 복사',
      selection: { kind: 'all' },
    }))
    assert.deepEqual(blocked.rejection, { code: 'not-found' })
  } finally {
    await database.close()
  }
})

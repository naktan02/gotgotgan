import type { Pool, PoolClient } from 'pg'

import {
  decodePlaceFilingCursor,
  decodeWorkspaceCollectionCursor,
  decodeWorkspaceFavoriteCursor,
  encodePlaceFilingCursor,
  encodeWorkspaceCollectionCursor,
  encodeWorkspaceFavoriteCursor,
} from '../../application/collection-first-cursor.js'
import { fingerprintLibraryCommand } from '../../application/fingerprint.js'
import {
  buildLibraryPlaceFacets,
  libraryFacetFilterScanLimit,
  libraryFacetSampleLimit,
  matchesLibraryPlaceFacets,
} from '../../application/library-place-facets.js'
import type { LibraryPlaceSummaryReader } from '../../application/ports/library-place-summary-reader.js'
import type {
  CollectionLifecycle,
  CollectionOrder,
  PersonalLibraryWorkspace,
  PlaceFiling,
} from '../../application/ports/collection-first.js'
import type {
  CollectionLifecycleCommand,
  CollectionLifecycleReceipt,
  CollectionOrderMove,
  CollectionOrderReceipt,
  CollectionWorkspaceSummary,
  LibraryWriteRejection,
  LibraryWriteResult,
  OpaqueVersion,
  PersonalLibraryWorkspaceQuery,
  PlaceFilingMutation,
  PlaceFilingReceipt,
} from '../../domain/collection-first.js'
import { InvalidLibraryQueryError, type LibraryPlaceSummary } from '../../domain/queries.js'

type CollectionRow = Readonly<{
  id: string
  name: string
  description: string | null
  visibility: 'private' | 'unlisted' | 'public'
  publication_id: string | null
  place_count: number
  revision: string
  updated_at: Date
}>

type FavoriteRow = Readonly<{
  canonical_place_id: string
  collection_count: number
  tag_ids: string[]
  personal_rating: string | null
}>

type FilingRow = Readonly<{
  id: string
  name: string
  included: boolean
  revision: string
  updated_at: Date
}>

type FilterUniverseRow = Readonly<{
  canonical_place_id: string
  favorite_place_count: number
}>

type OperationReceiptRow = Readonly<{
  membership_id: string
  operation_kind: string
  operation_fingerprint: string
  outcome: string
  result: Record<string, unknown>
}>

const operationNamespace = 'gotgotgan.library.v2'

function collectionVersion(collectionId: string, revision: string | number): OpaqueVersion {
  const payload = Buffer.from(JSON.stringify({ v: 1, collectionId, revision: String(revision) }), 'utf8')
    .toString('base64url')
  return `collection-revision.v1.${payload}` as OpaqueVersion
}

function readCollectionRevision(
  value: OpaqueVersion,
  collectionId: string,
): string | undefined {
  const encoded = value.startsWith('collection-revision.v1.')
    ? value.slice('collection-revision.v1.'.length)
    : undefined
  if (encoded === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (
      parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).v !== 1 ||
      (parsed as Record<string, unknown>).collectionId !== collectionId ||
      !/^\d+$/.test(String((parsed as Record<string, unknown>).revision))
    ) return undefined
    return String((parsed as Record<string, unknown>).revision)
  } catch {
    return undefined
  }
}

function collectionSummary(row: CollectionRow): CollectionWorkspaceSummary {
  return {
    collectionId: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    publicationId: row.publication_id,
    placeCount: row.place_count,
    version: collectionVersion(row.id, row.revision),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function summariesById(
  read: LibraryPlaceSummaryReader,
  placeIds: readonly string[],
): Promise<ReadonlyMap<string, LibraryPlaceSummary>> {
  const requested = new Set(placeIds)
  return new Map((await read(placeIds))
    .filter((summary) => requested.has(summary.placeId))
    .map((summary) => [summary.placeId, summary]))
}

function operationFingerprint(
  kind: string,
  memberId: string,
  input: Record<string, unknown>,
): string {
  return fingerprintLibraryCommand({ namespace: operationNamespace, kind, memberId, input })
}

async function lockOperation(
  client: PoolClient,
  operationId: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.library.v2:' || $1, 0))",
    [operationId],
  )
}

async function readPrior<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
  }>,
): Promise<LibraryWriteResult<Value> | undefined> {
  const result = await client.query<OperationReceiptRow>(
    `SELECT membership_id, operation_kind, operation_fingerprint, outcome, result
     FROM library.operation_receipts_v2 WHERE operation_id = $1::uuid`,
    [input.operationId],
  )
  const prior = result.rows[0]
  if (prior === undefined) return undefined
  if (
    prior.membership_id !== input.memberId || prior.operation_kind !== input.kind ||
    prior.operation_fingerprint !== input.fingerprint
  ) {
    return {
      status: 'rejected', operationId: input.operationId,
      rejection: { code: 'operation-id-reused' },
    }
  }
  if (prior.outcome === 'applied') {
    return {
      status: 'replayed', operationId: input.operationId,
      value: prior.result.value as Value,
    }
  }
  return {
    status: 'rejected', operationId: input.operationId,
    rejection: prior.result.rejection as LibraryWriteRejection,
  }
}

async function recordApplied<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
    occurredAt: string
    value: Value
  }>,
): Promise<LibraryWriteResult<Value>> {
  await client.query(
    `INSERT INTO library.operation_receipts_v2 (
       operation_id, membership_id, operation_kind, operation_fingerprint,
       outcome, result, occurred_at
     ) VALUES ($1::uuid,$2::uuid,$3,$4,'applied',$5::jsonb,$6::timestamptz)`,
    [input.operationId, input.memberId, input.kind, input.fingerprint,
      JSON.stringify({ value: input.value }), input.occurredAt],
  )
  return { status: 'applied', operationId: input.operationId, value: input.value }
}

async function recordRejected<Value>(
  client: PoolClient,
  input: Readonly<{
    operationId: string
    memberId: string
    kind: string
    fingerprint: string
    occurredAt: string
    rejection: LibraryWriteRejection
  }>,
): Promise<LibraryWriteResult<Value>> {
  await client.query(
    `INSERT INTO library.operation_receipts_v2 (
       operation_id, membership_id, operation_kind, operation_fingerprint,
       outcome, result, occurred_at
     ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::timestamptz)`,
    [input.operationId, input.memberId, input.kind, input.fingerprint,
      input.rejection.code, JSON.stringify({ rejection: input.rejection }), input.occurredAt],
  )
  return { status: 'rejected', operationId: input.operationId, rejection: input.rejection }
}

async function placeOverlay(
  client: PoolClient,
  memberId: string,
  placeId: string,
): Promise<Readonly<{ collectionMembershipCount: number; personalRating: number | null }>> {
  const result = await client.query<{
    collection_count: number
    personal_rating: string | null
  }>(
    `SELECT
       (SELECT count(*)::int
        FROM library.collection_places AS placed
        JOIN library.collections AS collection ON collection.id = placed.collection_id
        WHERE collection.owner_membership_id = $1::uuid
          AND placed.canonical_place_id = $2::uuid) AS collection_count,
       (SELECT personal_rating
        FROM library.place_preferences
        WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid) AS personal_rating`,
    [memberId, placeId],
  )
  const row = result.rows[0]!
  return {
    collectionMembershipCount: row.collection_count,
    personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
  }
}

export class PostgresPersonalLibraryWorkspace implements PersonalLibraryWorkspace {
  constructor(
    private readonly pool: Pool,
    private readonly readPlaceSummaries: LibraryPlaceSummaryReader,
  ) {}

  async open(query: PersonalLibraryWorkspaceQuery) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
      throw new InvalidLibraryQueryError('Library query limit must be between 1 and 50.')
    }
    if (query.favoriteScope.kind === 'collection') {
      const owned = await this.pool.query(
        `SELECT 1 FROM library.collections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [query.favoriteScope.collectionId, query.memberId],
      )
      if (owned.rows[0] === undefined) return undefined
    }
    const collectionCursor = decodeWorkspaceCollectionCursor(query.collectionCursor, query)
    const placeCursor = decodeWorkspaceFavoriteCursor(query.placeCursor, query)
    const collectionsResult = await this.pool.query<CollectionRow>(
      `SELECT collection.id, collection.name, collection.description, collection.visibility,
              collection.publication_id, count(placed.canonical_place_id)::int AS place_count,
              collection.revision::text, collection.updated_at
       FROM library.collections AS collection
       LEFT JOIN library.collection_places AS placed ON placed.collection_id = collection.id
       WHERE collection.owner_membership_id = $1::uuid
         AND ($2::timestamptz IS NULL OR collection.updated_at < $2::timestamptz
           OR (collection.updated_at = $2::timestamptz AND collection.id > $3::uuid))
       GROUP BY collection.id
       ORDER BY collection.updated_at DESC, collection.id ASC
       LIMIT $4`,
      [query.memberId, collectionCursor?.updatedAt ?? null,
        collectionCursor?.collectionId ?? null, query.limit + 1],
    )
    const hasMoreCollections = collectionsResult.rows.length > query.limit
    const collectionRows = collectionsResult.rows.slice(0, query.limit)

    const facetFiltered = query.areaKeys.length > 0 || query.taxonomyKeys.length > 0
    const scanLimit = facetFiltered ? libraryFacetFilterScanLimit : query.limit
    const selectedCollectionId = query.favoriteScope.kind === 'collection'
      ? query.favoriteScope.collectionId
      : null
    const favoritesResult = await this.pool.query<FavoriteRow>(
      `WITH candidates AS (
         SELECT DISTINCT placed.canonical_place_id
         FROM library.collection_places AS placed
         JOIN library.collections AS collection ON collection.id = placed.collection_id
         WHERE collection.owner_membership_id = $1::uuid
           AND ($2::uuid IS NULL OR collection.id = $2::uuid)
           AND ($3::uuid IS NULL OR placed.canonical_place_id > $3::uuid)
       )
       SELECT candidate.canonical_place_id,
              (SELECT count(*)::int
               FROM library.collection_places AS all_placed
               JOIN library.collections AS all_collection
                 ON all_collection.id = all_placed.collection_id
               WHERE all_collection.owner_membership_id = $1::uuid
                 AND all_placed.canonical_place_id = candidate.canonical_place_id
              ) AS collection_count,
              coalesce(array_agg(DISTINCT tagged.tag_id)
                FILTER (WHERE tagged.tag_id IS NOT NULL), ARRAY[]::uuid[])::text[] AS tag_ids,
              preference.personal_rating
       FROM candidates AS candidate
       LEFT JOIN library.place_preferences AS preference
         ON preference.membership_id = $1::uuid
        AND preference.canonical_place_id = candidate.canonical_place_id
       LEFT JOIN library.place_tags AS tagged
         ON tagged.membership_id = $1::uuid
        AND tagged.canonical_place_id = candidate.canonical_place_id
       WHERE ($4::text = 'any'
           OR ($4::text = 'rated' AND preference.personal_rating IS NOT NULL)
           OR ($4::text = 'unrated' AND preference.personal_rating IS NULL))
       GROUP BY candidate.canonical_place_id, preference.personal_rating
       HAVING cardinality($5::uuid[]) = 0
          OR ($6::text = 'any' AND count(DISTINCT tagged.tag_id)
              FILTER (WHERE tagged.tag_id = ANY($5::uuid[])) > 0)
          OR ($6::text = 'all' AND count(DISTINCT tagged.tag_id)
              FILTER (WHERE tagged.tag_id = ANY($5::uuid[])) = cardinality($5::uuid[]))
       ORDER BY candidate.canonical_place_id ASC
       LIMIT $7`,
      [query.memberId, selectedCollectionId, placeCursor?.placeId ?? null,
        query.ratingFilter.kind, query.tagIds, query.tagMatch, scanLimit + 1],
    )
    const scannedRows = favoritesResult.rows.slice(0, scanLimit)
    const summaries = await summariesById(
      this.readPlaceSummaries,
      scannedRows.map((row) => row.canonical_place_id),
    )
    const matchingRows = scannedRows.filter((row) => matchesLibraryPlaceFacets(
      summaries.get(row.canonical_place_id),
      { areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys },
    ))
    const favoriteRows = matchingRows.slice(0, query.limit)
    const hasUnreturnedMatch = matchingRows.length > query.limit
    const hasUnscannedRows = favoritesResult.rows.length > scanLimit
    const favoriteCursorRow = hasUnreturnedMatch ? favoriteRows.at(-1) : scannedRows.at(-1)
    const lastCollection = collectionRows.at(-1)
    const filterUniverseResult = await this.pool.query<FilterUniverseRow>(
      `WITH favorite AS (
         SELECT DISTINCT placed.canonical_place_id
         FROM library.collection_places AS placed
         JOIN library.collections AS collection ON collection.id = placed.collection_id
         WHERE collection.owner_membership_id = $1::uuid
       )
       SELECT canonical_place_id, count(*) OVER()::int AS favorite_place_count
       FROM favorite
       ORDER BY canonical_place_id ASC
       LIMIT $2`,
      [query.memberId, libraryFacetSampleLimit],
    )
    const filterSummaries = await summariesById(
      this.readPlaceSummaries,
      filterUniverseResult.rows.map((row) => row.canonical_place_id),
    )
    const availableFacets = buildLibraryPlaceFacets({
      summaries: [...filterSummaries.values()],
      savedPlaceCount: filterUniverseResult.rows[0]?.favorite_place_count ?? 0,
      sampledPlaceCount: filterUniverseResult.rows.length,
    })

    return {
      schemaVersion: 'personal-library-workspace.v2' as const,
      filter: {
        favoriteScope: query.favoriteScope,
        ratingFilter: query.ratingFilter,
        tagIds: query.tagIds,
        tagMatch: query.tagMatch,
        areaKeys: query.areaKeys,
        taxonomyKeys: query.taxonomyKeys,
      },
      collections: {
        items: collectionRows.map(collectionSummary),
        ...(hasMoreCollections && lastCollection !== undefined ? {
          nextCursor: encodeWorkspaceCollectionCursor(query, {
            updatedAt: lastCollection.updated_at.toISOString(),
            collectionId: lastCollection.id,
          }),
        } : {}),
      },
      favoritePlaces: {
        items: favoriteRows.map((row) => ({
          placeId: row.canonical_place_id,
          collectionMembershipCount: row.collection_count,
          tagIds: row.tag_ids,
          personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
          place: summaries.get(row.canonical_place_id) ?? null,
        })),
        ...((hasUnreturnedMatch || hasUnscannedRows) && favoriteCursorRow !== undefined ? {
          nextCursor: encodeWorkspaceFavoriteCursor(query, {
            placeId: favoriteCursorRow.canonical_place_id,
          }),
        } : {}),
      },
      availableFilters: {
        coverage: {
          favoritePlaceCount: availableFacets.coverage.savedPlaceCount,
          sampledPlaceCount: availableFacets.coverage.sampledPlaceCount,
          projectedPlaceCount: availableFacets.coverage.projectedPlaceCount,
          complete: availableFacets.coverage.complete,
        },
        areas: availableFacets.areas,
        taxonomies: availableFacets.taxonomies,
      },
    }
  }
}

export class PostgresPlaceFiling implements PlaceFiling {
  constructor(private readonly pool: Pool) {}

  async open(query: Parameters<PlaceFiling['open']>[0]) {
    const cursor = decodePlaceFilingCursor(query.cursor, query.memberId, query.placeId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const place = await client.query(
        `SELECT id FROM places.canonical_places
         WHERE id = $1::uuid AND status = 'active'`,
        [query.placeId],
      )
      if (place.rows[0] === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      const [collections, overlay] = await Promise.all([
        client.query<FilingRow>(
          `SELECT collection.id, collection.name,
                  (placed.canonical_place_id IS NOT NULL) AS included,
                  collection.revision::text, collection.updated_at
           FROM library.collections AS collection
           LEFT JOIN library.collection_places AS placed
             ON placed.collection_id = collection.id
            AND placed.canonical_place_id = $2::uuid
           WHERE collection.owner_membership_id = $1::uuid
             AND ($3::timestamptz IS NULL OR collection.updated_at < $3::timestamptz
               OR (collection.updated_at = $3::timestamptz AND collection.id > $4::uuid))
           ORDER BY collection.updated_at DESC, collection.id ASC
           LIMIT $5`,
          [query.memberId, query.placeId, cursor?.updatedAt ?? null,
            cursor?.collectionId ?? null, query.limit + 1],
        ),
        placeOverlay(client, query.memberId, query.placeId),
      ])
      await client.query('COMMIT')
      const hasMore = collections.rows.length > query.limit
      const rows = collections.rows.slice(0, query.limit)
      const last = rows.at(-1)
      return {
        schemaVersion: 'place-filing.v2' as const,
        placeId: query.placeId,
        ...overlay,
        collections: rows.map((row) => ({
          collectionId: row.id,
          name: row.name,
          included: row.included,
          version: collectionVersion(row.id, row.revision),
        })),
        ...(hasMore && last !== undefined ? {
          nextCursor: encodePlaceFilingCursor(query.memberId, query.placeId, {
            updatedAt: last.updated_at.toISOString(), collectionId: last.id,
          }),
        } : {}),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async apply(mutation: PlaceFilingMutation): Promise<LibraryWriteResult<PlaceFilingReceipt>> {
    const kind = 'place-filing'
    const { context, ...payload } = mutation
    const fingerprint = operationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockOperation(client, context.operationId)
      const prior = await readPrior<PlaceFilingReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      const place = await client.query(
        `SELECT id FROM places.canonical_places
         WHERE id = $1::uuid AND status = 'active'`,
        [mutation.placeId],
      )
      const sorted = [...mutation.changes].sort((left, right) =>
        left.collectionId.localeCompare(right.collectionId))
      const locked = place.rows[0] === undefined ? { rows: [] } : await client.query<{
        id: string
        revision: string
      }>(
        `SELECT id, revision::text FROM library.collections
         WHERE owner_membership_id = $1::uuid AND id = ANY($2::uuid[])
         ORDER BY id ASC FOR UPDATE`,
        [context.memberId, sorted.map((change) => change.collectionId)],
      )
      if (place.rows[0] === undefined || locked.rows.length !== sorted.length) {
        const result = await recordRejected<PlaceFilingReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
        await client.query('COMMIT')
        return result
      }
      const revisions = new Map(locked.rows.map((row) => [row.id, row.revision]))
      if (sorted.some((change) =>
        readCollectionRevision(change.expectedVersion, change.collectionId) !==
          revisions.get(change.collectionId))) {
        const result = await recordRejected<PlaceFilingReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
        })
        await client.query('COMMIT')
        return result
      }

      const responseCollections: Array<{
        collectionId: string
        included: boolean
        version: OpaqueVersion
      }> = []
      for (const change of sorted) {
        const membership = await client.query(
          `SELECT position FROM library.collection_places
           WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
          [change.collectionId, mutation.placeId],
        )
        const included = membership.rows[0] !== undefined
        let changed = false
        if (change.desired === 'included' && !included) {
          await client.query(
            `INSERT INTO library.collection_places
               (collection_id, canonical_place_id, position, added_at)
             SELECT $1::uuid,$2::uuid,coalesce(max(position) + 1, 0),$3::timestamptz
             FROM library.collection_places WHERE collection_id = $1::uuid`,
            [change.collectionId, mutation.placeId, context.occurredAt],
          )
          changed = true
        } else if (change.desired === 'excluded' && included) {
          await client.query(
            `DELETE FROM library.collection_place_import_provenance
             WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
            [change.collectionId, mutation.placeId],
          )
          await client.query(
            `DELETE FROM library.collection_places
             WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid`,
            [change.collectionId, mutation.placeId],
          )
          changed = true
        }
        let revision = revisions.get(change.collectionId)!
        if (changed) {
          const updated = await client.query<{ revision: string }>(
            `UPDATE library.collections
             SET revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
             WHERE id = $1::uuid RETURNING revision::text`,
            [change.collectionId, context.occurredAt],
          )
          revision = updated.rows[0]!.revision
        }
        responseCollections.push({
          collectionId: change.collectionId,
          included: change.desired === 'included',
          version: collectionVersion(change.collectionId, revision),
        })
      }
      const overlay = await placeOverlay(client, context.memberId, mutation.placeId)
      const value: PlaceFilingReceipt = {
        placeId: mutation.placeId,
        ...overlay,
        collections: responseCollections,
      }
      const result = await recordApplied(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
        occurredAt: context.occurredAt, value,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

export class PostgresCollectionOrder implements CollectionOrder {
  constructor(private readonly pool: Pool) {}

  async move(input: CollectionOrderMove): Promise<LibraryWriteResult<CollectionOrderReceipt>> {
    const kind = 'collection-order'
    const { context, ...payload } = input
    const fingerprint = operationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockOperation(client, context.operationId)
      const prior = await readPrior<CollectionOrderReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      const collection = await client.query<{ revision: string }>(
        `SELECT revision::text FROM library.collections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [input.collectionId, context.memberId],
      )
      const currentRevision = collection.rows[0]?.revision
      if (currentRevision === undefined) {
        const result = await recordRejected<CollectionOrderReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'not-found' },
        })
        await client.query('COMMIT')
        return result
      }
      if (readCollectionRevision(input.expectedVersion, input.collectionId) !== currentRevision) {
        const result = await recordRejected<CollectionOrderReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
        })
        await client.query('COMMIT')
        return result
      }
      const current = await client.query<{ position: number }>(
        `SELECT position FROM library.collection_places
         WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
        [input.collectionId, input.placeId],
      )
      if (current.rows[0] === undefined) {
        const result = await recordRejected<CollectionOrderReceipt>(client, {
          operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
          occurredAt: context.occurredAt, rejection: { code: 'source-membership-missing' },
        })
        await client.query('COMMIT')
        return result
      }
      let targetPosition: number
      if (input.placement.kind === 'first') targetPosition = 0
      else if (input.placement.kind === 'last') {
        targetPosition = Number((await client.query<{ position: number }>(
          `SELECT coalesce(max(position), 0)::int AS position
           FROM library.collection_places WHERE collection_id = $1::uuid`,
          [input.collectionId],
        )).rows[0]!.position)
      } else {
        const anchor = await client.query<{ position: number }>(
          `SELECT position FROM library.collection_places
           WHERE collection_id = $1::uuid AND canonical_place_id = $2::uuid FOR UPDATE`,
          [input.collectionId, input.placement.placeId],
        )
        if (anchor.rows[0] === undefined) {
          const result = await recordRejected<CollectionOrderReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'anchor-not-found' },
          })
          await client.query('COMMIT')
          return result
        }
        const anchorPosition = anchor.rows[0].position
        const currentPosition = current.rows[0].position
        targetPosition = input.placement.kind === 'before'
          ? anchorPosition - (currentPosition < anchorPosition ? 1 : 0)
          : anchorPosition + (currentPosition > anchorPosition ? 1 : 0)
      }
      const currentPosition = current.rows[0].position
      if (targetPosition !== currentPosition) {
        await client.query('SET CONSTRAINTS library.collection_places_position_unique DEFERRED')
        await client.query(
          `UPDATE library.collection_places
           SET position = CASE
             WHEN canonical_place_id = $2::uuid THEN $4::int
             WHEN $4::int < $3::int THEN position + 1
             ELSE position - 1
           END
           WHERE collection_id = $1::uuid AND (
             canonical_place_id = $2::uuid
             OR ($4::int < $3::int AND position >= $4::int AND position < $3::int)
             OR ($4::int > $3::int AND position > $3::int AND position <= $4::int)
           )`,
          [input.collectionId, input.placeId, currentPosition, targetPosition],
        )
      }
      const updated = await client.query<{ revision: string }>(
        `UPDATE library.collections
         SET revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
         WHERE id = $1::uuid RETURNING revision::text`,
        [input.collectionId, context.occurredAt],
      )
      const value: CollectionOrderReceipt = {
        collectionId: input.collectionId,
        placeId: input.placeId,
        version: collectionVersion(input.collectionId, updated.rows[0]!.revision),
      }
      const result = await recordApplied(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
        occurredAt: context.occurredAt, value,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

export class PostgresCollectionLifecycle implements CollectionLifecycle {
  constructor(private readonly pool: Pool) {}

  async apply(
    input: CollectionLifecycleCommand,
  ): Promise<LibraryWriteResult<CollectionLifecycleReceipt>> {
    const kind = `collection-${input.kind}`
    const { context, ...payload } = input
    const fingerprint = operationFingerprint(kind, context.memberId, payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await lockOperation(client, context.operationId)
      const prior = await readPrior<CollectionLifecycleReceipt>(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
      })
      if (prior !== undefined) {
        await client.query('COMMIT')
        return prior
      }
      let value: CollectionLifecycleReceipt
      if (input.kind === 'create') {
        const created = await client.query<CollectionRow>(
          `INSERT INTO library.collections (
             id, owner_membership_id, name, description, visibility, publication_id,
             revision, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4,'private',NULL,1,$5::timestamptz,$5::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, name, description, visibility, publication_id,
                     0::int AS place_count, revision::text, updated_at`,
          [input.collectionId, context.memberId, input.name, input.description, context.occurredAt],
        )
        if (created.rows[0] === undefined) {
          const result = await recordRejected<CollectionLifecycleReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'not-found' },
          })
          await client.query('COMMIT')
          return result
        }
        value = { collection: collectionSummary(created.rows[0]) }
      } else {
        const current = await client.query<CollectionRow>(
          `SELECT collection.id, collection.name, collection.description, collection.visibility,
                  collection.publication_id,
                  (SELECT count(*)::int FROM library.collection_places AS placed
                   WHERE placed.collection_id = collection.id) AS place_count,
                  collection.revision::text, collection.updated_at
           FROM library.collections AS collection
           WHERE collection.id = $1::uuid AND collection.owner_membership_id = $2::uuid
           FOR UPDATE`,
          [input.collectionId, context.memberId],
        )
        const row = current.rows[0]
        if (row === undefined) {
          const result = await recordRejected<CollectionLifecycleReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'not-found' },
          })
          await client.query('COMMIT')
          return result
        }
        if (readCollectionRevision(input.expectedVersion, input.collectionId) !== row.revision) {
          const result = await recordRejected<CollectionLifecycleReceipt>(client, {
            operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
            occurredAt: context.occurredAt, rejection: { code: 'version-conflict' },
          })
          await client.query('COMMIT')
          return result
        }
        if (input.kind === 'delete') {
          await client.query(
            'DELETE FROM library.collection_place_import_provenance WHERE collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collection_import_provenance WHERE collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collection_copy_provenance WHERE target_collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collection_places WHERE collection_id = $1::uuid',
            [input.collectionId],
          )
          await client.query(
            'DELETE FROM library.collections WHERE id = $1::uuid AND owner_membership_id = $2::uuid',
            [input.collectionId, context.memberId],
          )
          value = { collection: null }
        } else {
          const visibility = input.visibility ?? row.visibility
          const updated = await client.query<CollectionRow>(
            `UPDATE library.collections
             SET name = coalesce($3::text, name),
                 description = CASE WHEN $4::boolean THEN $5::text ELSE description END,
                 visibility = $6,
                 publication_id = CASE
                   WHEN $6 = 'private' THEN NULL
                   WHEN visibility = 'private' THEN gen_random_uuid()
                   ELSE publication_id
                 END,
                 revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $7::timestamptz)
             WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             RETURNING id, name, description, visibility, publication_id,
                       $8::int AS place_count, revision::text, updated_at`,
            [input.collectionId, context.memberId, input.name ?? null,
              input.description !== undefined, input.description ?? null,
              visibility, context.occurredAt, row.place_count],
          )
          value = { collection: collectionSummary(updated.rows[0]!) }
        }
      }
      const result = await recordApplied(client, {
        operationId: context.operationId, memberId: context.memberId, kind, fingerprint,
        occurredAt: context.occurredAt, value,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

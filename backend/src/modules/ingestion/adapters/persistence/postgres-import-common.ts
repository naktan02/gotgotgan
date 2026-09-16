import type { Pool, PoolClient } from 'pg'

import type { PreparedImportItem } from '../../application/ports/import-worker-store.js'
import {
  ImportReferenceUnavailableError,
  type ImportBatchState,
  type ImportFailureCode,
  type PlaceImportBatch,
  type PlaceImportItem,
} from '../../domain/imports.js'

export type BatchRow = Readonly<{
  id: string
  connection_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  state: ImportBatchState
  failure_code: ImportFailureCode | null
  failure_retryable: boolean | null
  discovered_count: number
  ready_count: number
  review_required_count: number
  enriching_count: number
  applied_count: number
  skipped_count: number
  failed_count: number
  created_at: string | Date
  updated_at: string | Date
}>

export type ItemRow = Readonly<{
  id: string
  batch_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  provider_place_id: string | null
  source_list_id: string
  source_item_id: string
  list_name: string
  display_name: string
  address: string | null
  category_label: string | null
  latitude: number | null
  longitude: number | null
  status: PlaceImportItem['status']
  review_reasons: readonly string[]
  canonical_place_id: string | null
  detail_status: 'pending' | 'available' | 'unavailable'
}>

export function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function batch(row: BatchRow): PlaceImportBatch {
  return {
    batchId: row.id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    state: row.state,
    progress: {
      discovered: row.discovered_count,
      ready: row.ready_count,
      reviewRequired: row.review_required_count,
      enriching: row.enriching_count,
      applied: row.applied_count,
      skipped: row.skipped_count,
      failed: row.failed_count,
    },
    ...(row.failure_code === null || row.failure_retryable === null
      ? {}
      : { failure: { code: row.failure_code, retryable: row.failure_retryable } }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function item(row: ItemRow): PlaceImportItem {
  return {
    itemId: row.id,
    batchId: row.batch_id,
    providerKey: row.provider_key,
    ...(row.provider_place_id === null ? {} : { providerPlaceId: row.provider_place_id }),
    sourceListId: row.source_list_id,
    sourceItemId: row.source_item_id,
    listName: row.list_name,
    name: row.display_name,
    address: row.address,
    categoryLabel: row.category_label,
    location: row.latitude === null || row.longitude === null
      ? null
      : { latitude: row.latitude, longitude: row.longitude },
    status: row.status,
    reviewReasons: row.review_reasons,
    ...(row.canonical_place_id === null ? {} : { canonicalPlaceId: row.canonical_place_id }),
    detailStatus: row.detail_status,
  }
}

export async function selectBatch(
  client: Pool | PoolClient,
  batchId: string,
  memberId?: string,
): Promise<PlaceImportBatch | undefined> {
  const selected = await client.query<BatchRow>(
    `SELECT * FROM ingestion.import_batches
     WHERE id = $1::uuid ${memberId === undefined ? '' : 'AND member_id = $2::uuid'}`,
    memberId === undefined ? [batchId] : [batchId, memberId],
  )
  const row = selected.rows[0]
  return row === undefined ? undefined : batch(row)
}

export async function refreshBatchProgresses(
  client: Pool | PoolClient,
  batchIds: readonly string[],
  updatedAt: string,
): Promise<void> {
  if (batchIds.length === 0) return
  await client.query(
    `WITH target_batches AS (
       SELECT DISTINCT unnest($1::uuid[]) AS batch_id
     ), counts AS (
       SELECT target.batch_id,
              count(imported.id)::int AS discovered,
              count(*) FILTER (WHERE status = 'ready')::int AS ready,
              count(*) FILTER (WHERE status = 'needs-review')::int AS review_required,
              count(*) FILTER (WHERE status = 'enriching')::int AS enriching,
              count(*) FILTER (WHERE status = 'applied')::int AS applied,
              count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM target_batches AS target
       LEFT JOIN ingestion.import_items AS imported ON imported.batch_id = target.batch_id
       GROUP BY target.batch_id
     )
     UPDATE ingestion.import_batches AS batch
     SET state = CASE
           WHEN counts.enriching > 0 THEN 'enriching'
           WHEN counts.ready + counts.review_required > 0 THEN 'needs-review'
           WHEN counts.discovered > 0 AND counts.failed = counts.discovered THEN 'failed'
           WHEN counts.failed > 0 THEN 'partial'
           ELSE 'completed'
         END,
         discovered_count = counts.discovered,
         ready_count = counts.ready,
         review_required_count = counts.review_required,
         enriching_count = counts.enriching,
         applied_count = counts.applied,
         skipped_count = counts.skipped,
         failed_count = counts.failed,
         updated_at = $2::timestamptz
     FROM counts
     WHERE batch.id = counts.batch_id AND batch.state <> 'cancelled'`,
    [batchIds, updatedAt],
  )
}

export async function refreshBatchProgress(
  client: Pool | PoolClient,
  batchId: string,
  updatedAt: string,
): Promise<void> {
  await refreshBatchProgresses(client, [batchId], updatedAt)
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export async function insertPreparedImportItems(
  client: PoolClient,
  input: Readonly<{
    batchId: string
    captureId: string
    providerKey: 'naver' | 'kakao' | 'google'
    items: readonly PreparedImportItem[]
    recordedAt: string
  }>,
): Promise<void> {
  if (input.items.length === 0) return
  for (const imported of input.items) {
    if (imported.fulfillment !== undefined && imported.providerPlaceId === undefined) {
      throw new ImportReferenceUnavailableError('Fulfillment requires a provider place identity.')
    }
  }

  const preparedRows = input.items.map((imported) => ({
    item_id: imported.itemId,
    source_item_key: imported.sourceItemKey,
    source_item_id: imported.sourceItemId,
    provider_place_id: imported.providerPlaceId ?? null,
    source_list_id: imported.sourceListId,
    source_list_position: imported.sourceListPosition,
    source_position: imported.sourcePosition,
    list_name: imported.listName,
    display_name: imported.name,
    address: imported.address,
    category_label: imported.categoryLabel,
    latitude: imported.location?.latitude ?? null,
    longitude: imported.location?.longitude ?? null,
    status: imported.fulfillment === undefined ? 'needs-review' : 'enriching',
    review_reasons: imported.reviewReasons,
    observation_id: imported.observationId,
    candidate_id: imported.candidateId,
    decision_id: imported.decisionId,
    proposed_place_id: imported.proposedPlaceId,
  }))
  const insertedItems = await client.query<{ id: string }>(
    `WITH prepared AS (
       SELECT * FROM jsonb_to_recordset($4::jsonb) AS item(
         item_id uuid, source_item_key text, source_item_id text, provider_place_id text,
         source_list_id text, source_list_position integer, source_position integer,
         list_name text, display_name text, address text, category_label text,
         latitude double precision, longitude double precision, status text,
         review_reasons text[], observation_id uuid, candidate_id uuid,
         decision_id uuid, proposed_place_id uuid
       )
     )
     INSERT INTO ingestion.import_items (
       id, batch_id, capture_id, source_item_key, source_item_id, provider_place_id,
       source_list_id, source_list_position, source_position, list_name,
       display_name, address, category_label, location, status, review_reasons,
       observation_id, candidate_id, decision_id, proposed_place_id, created_at, updated_at
     )
     SELECT item_id,$1::uuid,$2::uuid,source_item_key,source_item_id,provider_place_id,
            source_list_id,source_list_position,source_position,list_name,
            display_name,address,category_label,
            CASE WHEN latitude IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) END,
            status,review_reasons,observation_id,candidate_id,decision_id,proposed_place_id,
            $3::timestamptz,$3::timestamptz
     FROM prepared
     ON CONFLICT (batch_id, source_item_key) DO NOTHING
     RETURNING id`,
    [input.batchId, input.captureId, input.recordedAt, JSON.stringify(preparedRows)],
  )
  const insertedIds = new Set(insertedItems.rows.map((row) => row.id))
  if (insertedIds.size === 0) return
  const inserted = input.items.filter((item) => insertedIds.has(item.itemId))

  const providerPlaceIds = [...new Set(inserted.flatMap((item) =>
    item.providerPlaceId === undefined ? [] : [item.providerPlaceId]))]
  if (providerPlaceIds.length > 0) {
    await client.query(
      `INSERT INTO ingestion.provider_place_detail_statuses (
         provider_key, provider_place_id, status, requested_at, updated_at
       )
       SELECT $1, provider_place_id, 'pending', $3::timestamptz, $3::timestamptz
       FROM unnest($2::text[]) AS provider_place_id
       ON CONFLICT (provider_key, provider_place_id) DO NOTHING`,
      [input.providerKey, providerPlaceIds, input.recordedAt],
    )
  }

  const detailRows = inserted.flatMap((imported) => (
    imported.providerPlaceId === undefined || imported.detail === undefined
      ? []
      : [{
          provider_place_id: imported.providerPlaceId,
          job_id: imported.detail.jobId,
          observation_id: imported.detail.observationId,
          candidate_id: imported.detail.candidateId,
        }]
  ))
  if (detailRows.length > 0) {
    await client.query(
      `WITH prepared AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS detail_input(
           provider_place_id text, job_id uuid, observation_id uuid, candidate_id uuid
         )
       )
       INSERT INTO ingestion.provider_place_detail_jobs (
         id, provider_key, provider_place_id, state, available_at,
         observation_id, candidate_id, created_at, updated_at
       )
       SELECT job_id,$1,provider_place_id,'queued',$2::timestamptz,
              observation_id,candidate_id,$2::timestamptz,$2::timestamptz
       FROM prepared
       ON CONFLICT (provider_key, provider_place_id)
         WHERE state IN ('queued', 'waiting', 'leased') DO NOTHING`,
      [input.providerKey, input.recordedAt, JSON.stringify(detailRows)],
    )
  }

  const fulfillmentByPlace = new Map<string, NonNullable<PreparedImportItem['fulfillment']>>()
  for (const imported of inserted) {
    if (imported.fulfillment !== undefined) {
      if (imported.providerPlaceId === undefined) {
        throw new ImportReferenceUnavailableError('Fulfillment requires a provider place identity.')
      }
      if (!fulfillmentByPlace.has(imported.providerPlaceId)) {
        fulfillmentByPlace.set(imported.providerPlaceId, imported.fulfillment)
      }
    }
  }
  if (fulfillmentByPlace.size === 0) return
  const jobRows = [...fulfillmentByPlace].map(([providerPlaceId, fulfillment]) => ({
    provider_place_id: providerPlaceId,
    job_id: fulfillment.jobId,
    observation_id: fulfillment.observationId,
    candidate_id: fulfillment.candidateId,
    decision_id: fulfillment.decisionId,
    proposed_place_id: fulfillment.proposedPlaceId,
  }))
  const jobs = await client.query<{ id: string; provider_place_id: string }>(
    `WITH prepared AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb) AS job_input(
         provider_place_id text, job_id uuid, observation_id uuid,
         candidate_id uuid, decision_id uuid, proposed_place_id uuid
       )
     )
     INSERT INTO ingestion.import_place_fulfillment_jobs AS job (
       id, provider_key, provider_place_id, state, available_at,
       observation_id, candidate_id, decision_id, proposed_place_id,
       created_at, updated_at
     )
     SELECT job_id,$1,provider_place_id,'queued',$2::timestamptz,
            observation_id,candidate_id,decision_id,proposed_place_id,
            $2::timestamptz,$2::timestamptz
     FROM prepared
     ON CONFLICT (provider_key, provider_place_id) DO UPDATE
     SET state = CASE
           WHEN job.state IN ('completed', 'failed') THEN 'queued'
           ELSE job.state
         END,
         available_at = CASE
           WHEN job.state IN ('completed', 'failed') THEN EXCLUDED.available_at
           ELSE job.available_at
         END,
         attempt_count = CASE
           WHEN job.state IN ('completed', 'failed') THEN 0
           ELSE job.attempt_count
         END,
         failure_code = CASE
           WHEN job.state IN ('completed', 'failed') THEN NULL
           ELSE job.failure_code
         END,
         failure_retryable = CASE
           WHEN job.state IN ('completed', 'failed') THEN NULL
           ELSE job.failure_retryable
         END,
         updated_at = EXCLUDED.updated_at
     RETURNING job.id, job.provider_place_id`,
    [input.providerKey, input.recordedAt, JSON.stringify(jobRows)],
  )
  const jobIdByProviderPlace = new Map(
    jobs.rows.map((row) => [row.provider_place_id, row.id]),
  )
  const intentRows = inserted.flatMap((imported) => {
    if (imported.fulfillment === undefined || imported.providerPlaceId === undefined) return []
    const jobId = jobIdByProviderPlace.get(imported.providerPlaceId)
    return jobId === undefined ? [] : [{ item_id: imported.itemId, job_id: jobId }]
  })
  await client.query(
    `WITH prepared AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS intent_input(
         item_id uuid, job_id uuid
       )
     )
     INSERT INTO ingestion.import_place_fulfillment_intents (
       item_id, job_id, state, created_at, updated_at
     )
     SELECT item_id,job_id,'pending',$1::timestamptz,$1::timestamptz
     FROM prepared
     ON CONFLICT (item_id) DO NOTHING`,
    [input.recordedAt, JSON.stringify(intentRows)],
  )
}

export async function updateImportBatchAfterCapture(
  client: PoolClient,
  batchId: string,
  final: boolean,
  updatedAt: string,
): Promise<'partial' | 'completed' | 'enriching' | 'needs-review'> {
  const counts = await client.query<{
    discovered: number
    ready: number
    review_required: number
    enriching: number
    applied: number
    skipped: number
    failed: number
  }>(
    `SELECT count(*)::int AS discovered,
            count(*) FILTER (WHERE status = 'ready')::int AS ready,
            count(*) FILTER (WHERE status = 'needs-review')::int AS review_required,
            count(*) FILTER (WHERE status = 'enriching')::int AS enriching,
            count(*) FILTER (WHERE status = 'applied')::int AS applied,
            count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM ingestion.import_items WHERE batch_id = $1::uuid`,
    [batchId],
  )
  const progress = counts.rows[0]!
  const state = !final
    ? 'partial' as const
    : progress.discovered === 0
      ? 'completed' as const
      : progress.enriching > 0
        ? 'enriching' as const
        : 'needs-review' as const
  await client.query(
    `UPDATE ingestion.import_batches
     SET state = $2, failure_code = NULL, failure_retryable = NULL,
         discovered_count = $3, ready_count = $4, review_required_count = $5,
         enriching_count = $6, applied_count = $7, skipped_count = $8, failed_count = $9,
         updated_at = $10::timestamptz
     WHERE id = $1::uuid`,
    [batchId, state, progress.discovered, progress.ready,
      progress.review_required, progress.enriching, progress.applied, progress.skipped,
      progress.failed, updatedAt],
  )
  return state
}

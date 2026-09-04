import type { PoolClient } from 'pg'

export async function scheduleInitialProviderPlaceDetails(
  client: Pick<PoolClient, 'query'>,
  input: Readonly<{
    snapshotId: string
    providerKey: 'naver' | 'google' | 'kakao'
    requestedAt: string
  }>,
): Promise<void> {
  await client.query(
    `SELECT ingestion.schedule_initial_provider_place_details(
       $2,
       coalesce(array_agg(DISTINCT item.provider_place_id), ARRAY[]::text[]),
       $3::timestamptz
     )
     FROM transfers.source_snapshot_items AS item
     WHERE item.snapshot_id = $1::uuid
       AND item.provider_place_id IS NOT NULL
       AND item.canonical_place_id IS NULL
       AND item.match_reason = 'missing-identity'`,
    [input.snapshotId, input.providerKey, input.requestedAt],
  )
}

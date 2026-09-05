import type { Pool } from 'pg'

export type MemberImportedPlace = Readonly<{
  placeId: string
  observedName: string
  observedLocation: Readonly<{ latitude: number; longitude: number }> | null
  capturedAt: string
}>

/** Reads only the caller's successfully materialized snapshot facts, never global facts. */
export class PostgresMemberImportedPlaces {
  constructor(private readonly pool: Pool) {}

  async read(memberId: string, placeIds: readonly string[]): Promise<readonly MemberImportedPlace[]> {
    if (placeIds.length === 0) return []
    if (placeIds.length > 2_000) throw new Error('member import projection exceeds bounded limit')
    const rows = await this.pool.query<{
      canonical_place_id: string
      observed_name: string
      latitude: number | null
      longitude: number | null
      captured_at: Date
    }>(
      `SELECT DISTINCT ON (applied.canonical_place_id)
              applied.canonical_place_id, item.observed_name,
              ST_Y(item.observed_location) AS latitude, ST_X(item.observed_location) AS longitude,
              snapshot.captured_at
       FROM transfers.operation_items AS applied
       JOIN transfers.operations AS operation ON operation.id = applied.operation_id
       JOIN transfers.import_plans AS plan ON plan.id = operation.resource_id
       JOIN transfers.import_plan_items AS planned
         ON planned.plan_id = plan.id
        AND applied.item_key = encode(sha256(convert_to(jsonb_build_array(
          planned.source_list_id::text, planned.source_item_id::text)::text, 'UTF8')), 'hex')
       JOIN transfers.import_plan_mappings AS mapping
         ON mapping.plan_id = plan.id AND mapping.source_list_id = planned.source_list_id
       JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
       JOIN transfers.source_snapshot_items AS item
         ON item.snapshot_id = snapshot.id AND item.source_list_id = planned.source_list_id
        AND item.source_item_id = planned.source_item_id
       WHERE operation.owner_membership_id = $1::uuid
         AND plan.owner_membership_id = $1::uuid AND snapshot.owner_membership_id = $1::uuid
         AND operation.kind = 'import-materialization'
         AND operation.resource_kind = 'import-plan'
         AND applied.status IN ('applied','already-present')
         AND mapping.materialization_state = 'applied'
         AND applied.canonical_place_id = ANY($2::uuid[])
       ORDER BY applied.canonical_place_id, snapshot.captured_at DESC, snapshot.id DESC,
                item.source_list_id, item.source_item_id`,
      [memberId, [...new Set(placeIds)]],
    )
    return rows.rows.map((row) => ({
      placeId: row.canonical_place_id,
      observedName: row.observed_name,
      observedLocation: row.latitude === null || row.longitude === null
        ? null : { latitude: row.latitude, longitude: row.longitude },
      capturedAt: row.captured_at.toISOString(),
    }))
  }
}

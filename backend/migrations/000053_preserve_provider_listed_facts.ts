import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE search.place_documents ADD COLUMN canonical_profile_revision bigint
      CHECK (canonical_profile_revision > 0);
    ALTER TABLE transfers.source_snapshot_items ADD COLUMN provider_listed_facts jsonb;
    ALTER TABLE transfers.source_snapshot_items ADD CONSTRAINT provider_listed_facts_v1_shape CHECK (
      provider_listed_facts IS NULL OR (
        jsonb_typeof(provider_listed_facts) = 'object'
        AND provider_listed_facts ?& ARRAY['schemaVersion','name','address','categoryLabel','location']
        AND provider_listed_facts - 'schemaVersion' - 'name' - 'address' - 'categoryLabel' - 'location' = '{}'::jsonb
        AND jsonb_typeof(provider_listed_facts -> 'schemaVersion') = 'string'
        AND provider_listed_facts ->> 'schemaVersion' = 'provider-listed-facts.v1'
        AND jsonb_typeof(provider_listed_facts -> 'name') = 'string'
        AND length(btrim(provider_listed_facts ->> 'name')) BETWEEN 1 AND 300
        AND (provider_listed_facts -> 'address' = 'null'::jsonb OR (
          jsonb_typeof(provider_listed_facts -> 'address') = 'string'
          AND length(btrim(provider_listed_facts ->> 'address')) BETWEEN 1 AND 500
        ))
        AND (provider_listed_facts -> 'categoryLabel' = 'null'::jsonb OR (
          jsonb_typeof(provider_listed_facts -> 'categoryLabel') = 'string'
          AND length(btrim(provider_listed_facts ->> 'categoryLabel')) BETWEEN 1 AND 300
        ))
        AND (provider_listed_facts -> 'location' = 'null'::jsonb OR (
          jsonb_typeof(provider_listed_facts -> 'location') = 'object'
          AND (provider_listed_facts -> 'location') ?& ARRAY['latitude','longitude']
          AND (provider_listed_facts -> 'location') - 'latitude' - 'longitude' = '{}'::jsonb
          AND jsonb_typeof(provider_listed_facts -> 'location' -> 'latitude') = 'number'
          AND jsonb_typeof(provider_listed_facts -> 'location' -> 'longitude') = 'number'
          AND (provider_listed_facts -> 'location' ->> 'latitude')::numeric BETWEEN -90 AND 90
          AND (provider_listed_facts -> 'location' ->> 'longitude')::numeric BETWEEN -180 AND 180
        ))
      )
    );
    COMMENT ON COLUMN transfers.source_snapshot_items.provider_listed_facts IS
      'Versioned server parser venue facts, separate from a private bookmark alias. NULL legacy data is not eligible for automatic public publication.';
  `)
}

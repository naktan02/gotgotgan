import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE FUNCTION search.valid_taxonomy_references(
      candidate jsonb,
      projected_keys text[],
      primary_key text
    )
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path = pg_catalog
    AS $$
    DECLARE
      item jsonb;
      seen jsonb := '[]'::jsonb;
      identity jsonb;
      version_text text;
    BEGIN
      IF candidate IS NULL OR projected_keys IS NULL
        OR jsonb_typeof(candidate) <> 'array' OR jsonb_array_length(candidate) > 32
      THEN
        RETURN false;
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(candidate)
      LOOP
        IF jsonb_typeof(item) <> 'object'
          OR NOT item ?& ARRAY['key', 'version', 'kind']
          OR item - ARRAY['key', 'version', 'kind'] <> '{}'::jsonb
          OR jsonb_typeof(item->'key') <> 'string'
          OR length(item->>'key') NOT BETWEEN 1 AND 128
          OR jsonb_typeof(item->'version') <> 'number'
          OR jsonb_typeof(item->'kind') <> 'string'
          OR item->>'kind' NOT IN ('category', 'attribute')
        THEN
          RETURN false;
        END IF;
        version_text := item->>'version';
        IF version_text !~ '^[1-9][0-9]{0,17}$' OR version_text::numeric > 9007199254740991 THEN
          RETURN false;
        END IF;
        identity := jsonb_build_object('key', item->>'key', 'version', version_text::numeric);
        IF seen @> jsonb_build_array(identity) THEN
          RETURN false;
        END IF;
        seen := seen || jsonb_build_array(identity);
      END LOOP;
      IF jsonb_array_length(candidate) > 0 THEN
        IF cardinality(projected_keys) <> jsonb_array_length(candidate)
          OR EXISTS (
            SELECT 1 FROM unnest(projected_keys) AS projected_key
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(candidate) AS reference
              WHERE reference->>'key' = projected_key
            )
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(candidate) AS reference
            WHERE NOT (reference->>'key' = ANY(projected_keys))
          )
          OR (
            primary_key IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(candidate) AS reference
              WHERE reference->>'key' = primary_key
                AND reference->>'kind' = 'category'
            )
          )
        THEN
          RETURN false;
        END IF;
      END IF;
      RETURN true;
    END;
    $$;

    REVOKE ALL ON FUNCTION search.valid_taxonomy_references(jsonb, text[], text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION search.valid_taxonomy_references(jsonb, text[], text) TO place_app;

    ALTER TABLE search.place_documents
      ALTER COLUMN location DROP NOT NULL,
      ADD COLUMN area_key text,
      ADD COLUMN area_version bigint,
      ADD COLUMN taxonomy_references jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD CONSTRAINT search_place_documents_area_reference_valid CHECK (
        (area_key IS NULL AND area_version IS NULL)
        OR (
          length(area_key) BETWEEN 1 AND 128
          AND area_version > 0
        )
      ),
      ADD CONSTRAINT search_place_documents_taxonomy_references_valid
        CHECK (search.valid_taxonomy_references(
          taxonomy_references,
          taxonomy_keys,
          primary_taxonomy_key
        ));

    UPDATE search.place_documents AS document
    SET
      area_key = (
        SELECT assignment.area_key
        FROM places.canonical_place_profile_areas AS assignment
        WHERE assignment.canonical_place_id = place.id
          AND assignment.profile_revision = place.current_profile_revision
          AND assignment.assignment_role = 'primary'
      ),
      area_version = (
        SELECT assignment.area_version
        FROM places.canonical_place_profile_areas AS assignment
        WHERE assignment.canonical_place_id = place.id
          AND assignment.profile_revision = place.current_profile_revision
          AND assignment.assignment_role = 'primary'
      ),
      taxonomy_keys = COALESCE((
        SELECT array_agg(assignment.node_key ORDER BY assignment.ordinal)
        FROM places.canonical_place_profile_taxonomy AS assignment
        WHERE assignment.canonical_place_id = place.id
          AND assignment.profile_revision = place.current_profile_revision
      ), '{}'::text[]),
      taxonomy_references = COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'key', assignment.node_key,
          'version', assignment.node_version,
          'kind', CASE WHEN assignment.assignment_role = 'attribute'
            THEN 'attribute' ELSE 'category' END
        ) ORDER BY assignment.ordinal)
        FROM places.canonical_place_profile_taxonomy AS assignment
        WHERE assignment.canonical_place_id = place.id
          AND assignment.profile_revision = place.current_profile_revision
      ), '[]'::jsonb),
      primary_taxonomy_key = (
        SELECT assignment.node_key
        FROM places.canonical_place_profile_taxonomy AS assignment
        WHERE assignment.canonical_place_id = place.id
          AND assignment.profile_revision = place.current_profile_revision
          AND assignment.assignment_role = 'primary'
      ),
      primary_taxonomy_label = (
        SELECT node.label
        FROM places.canonical_place_profile_taxonomy AS assignment
        JOIN taxonomy.node_versions AS node
          ON node.node_key = assignment.node_key
         AND node.version = assignment.node_version
        WHERE assignment.canonical_place_id = place.id
          AND assignment.profile_revision = place.current_profile_revision
          AND assignment.assignment_role = 'primary'
      )
    FROM places.canonical_places AS place
    WHERE place.id = document.place_id
      AND place.current_profile_revision IS NOT NULL;

    CREATE INDEX search_place_documents_area_version
      ON search.place_documents (area_key, area_version, place_id)
      WHERE area_key IS NOT NULL;
    CREATE INDEX search_place_documents_taxonomy_references_gin
      ON search.place_documents USING gin (taxonomy_references jsonb_path_ops);

    COMMENT ON COLUMN search.place_documents.area_key IS
      'Exact provider-neutral Area identity selected by the projected Canonical Place profile.';
    COMMENT ON COLUMN search.place_documents.area_version IS
      'Exact immutable Area node version paired with area_key.';
    COMMENT ON COLUMN search.place_documents.taxonomy_references IS
      'Bounded exact Taxonomy key/version/kind references selected by the projected Canonical Place profile.';
    COMMENT ON TABLE search.place_documents IS
      'Search-owned projection. Migration 000039 backfills exact Area and Taxonomy references from every current Canonical Place profile; later profile publication must reproject the document.';
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM search.place_documents WHERE location IS NULL
      ) THEN
        RAISE EXCEPTION 'cannot restore required search location while unlocated catalog documents exist';
      END IF;
      IF EXISTS (
        SELECT 1 FROM search.place_documents
        WHERE area_key IS NOT NULL OR taxonomy_references <> '[]'::jsonb
      ) THEN
        RAISE EXCEPTION 'cannot remove catalog search references while projected version data exists';
      END IF;
    END;
    $$;

    DROP INDEX search.search_place_documents_taxonomy_references_gin;
    DROP INDEX search.search_place_documents_area_version;
    ALTER TABLE search.place_documents
      DROP CONSTRAINT search_place_documents_taxonomy_references_valid,
      DROP CONSTRAINT search_place_documents_area_reference_valid,
      DROP COLUMN taxonomy_references,
      DROP COLUMN area_version,
      DROP COLUMN area_key,
      ALTER COLUMN location SET NOT NULL;
    DROP FUNCTION search.valid_taxonomy_references(jsonb, text[], text);
  `)
}

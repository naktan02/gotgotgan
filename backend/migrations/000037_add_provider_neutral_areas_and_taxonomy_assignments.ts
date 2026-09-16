import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA areas;
    REVOKE ALL ON SCHEMA areas FROM PUBLIC;

    CREATE FUNCTION areas.localized_names_are_valid(value jsonb)
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      entry record;
      entry_count integer := 0;
    BEGIN
      IF jsonb_typeof(value) <> 'object' THEN
        RETURN false;
      END IF;
      FOR entry IN SELECT * FROM jsonb_each(value)
      LOOP
        entry_count := entry_count + 1;
        IF length(entry.key) NOT BETWEEN 2 AND 35
          OR entry.key !~ '^(und|[A-Za-z]{2,3})(-[A-Za-z0-9]{2,8})*$'
          OR jsonb_typeof(entry.value) <> 'string'
          OR length(entry.value #>> '{}') NOT BETWEEN 1 AND 160 THEN
          RETURN false;
        END IF;
      END LOOP;
      RETURN entry_count BETWEEN 1 AND 32;
    END
    $function$;

    CREATE TABLE areas.area_identities (
      area_key text PRIMARY KEY CHECK (
        length(area_key) BETWEEN 1 AND 128
        AND area_key ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      ),
      created_at timestamptz NOT NULL
    );

    COMMENT ON TABLE areas.area_identities IS
      'Stable provider-neutral Area identities. Labels, hierarchy, and lifecycle are append-only versions rather than identity.';

    CREATE TABLE areas.area_node_versions (
      area_key text NOT NULL
        REFERENCES areas.area_identities (area_key),
      version integer NOT NULL CHECK (version > 0),
      previous_version integer,
      parent_area_key text REFERENCES areas.area_identities (area_key),
      country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
      kind text NOT NULL CHECK (
        kind IN (
          'country', 'administrative-area', 'locality', 'neighborhood', 'custom'
        )
      ),
      localized_names jsonb NOT NULL CHECK (
        areas.localized_names_are_valid(localized_names)
      ),
      default_language_tag text NOT NULL CHECK (
        length(default_language_tag) BETWEEN 2 AND 35
        AND default_language_tag ~ '^(und|[A-Za-z]{2,3})(-[A-Za-z0-9]{2,8})*$'
      ),
      active boolean NOT NULL,
      effective_at timestamptz NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      PRIMARY KEY (area_key, version),
      FOREIGN KEY (area_key, previous_version)
        REFERENCES areas.area_node_versions (area_key, version)
        DEFERRABLE INITIALLY DEFERRED,
      CHECK (
        (version = 1 AND previous_version IS NULL)
        OR (version > 1 AND previous_version = version - 1)
      ),
      CHECK (parent_area_key IS NULL OR parent_area_key <> area_key),
      CHECK (localized_names ? default_language_tag),
      CHECK ((kind = 'country') = (parent_area_key IS NULL))
    );

    COMMENT ON TABLE areas.area_node_versions IS
      'Append-only localized Area hierarchy versions. Country-specific labels never become identity keys.';

    CREATE INDEX area_node_versions_current
      ON areas.area_node_versions (area_key, version DESC);
    CREATE INDEX area_node_versions_parent_current
      ON areas.area_node_versions (parent_area_key, version DESC, area_key)
      WHERE parent_area_key IS NOT NULL;
    CREATE INDEX area_node_versions_country_kind_current
      ON areas.area_node_versions (country_code, kind, area_key, version DESC)
      WHERE active;

    CREATE FUNCTION areas.reject_current_hierarchy_cycle()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      parent_country text;
      parent_active boolean;
      reaches_self boolean;
    BEGIN
      IF NOT NEW.active AND EXISTS (
        SELECT 1
        FROM areas.area_identities AS child_identity
        JOIN LATERAL (
          SELECT child.parent_area_key, child.active
          FROM areas.area_node_versions AS child
          WHERE child.area_key = child_identity.area_key
          ORDER BY child.version DESC
          LIMIT 1
        ) AS current_child ON true
        WHERE current_child.parent_area_key = NEW.area_key
          AND current_child.active
      ) THEN
        RAISE EXCEPTION 'Area with current active children cannot become inactive'
          USING ERRCODE = '23514';
      END IF;

      IF NOT NEW.active THEN
        RETURN NEW;
      END IF;
      IF NEW.parent_area_key IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT current_parent.country_code, current_parent.active
        INTO parent_country, parent_active
      FROM areas.area_node_versions AS current_parent
      WHERE current_parent.area_key = NEW.parent_area_key
      ORDER BY current_parent.version DESC
      LIMIT 1;

      IF parent_country IS NULL
        OR NOT parent_active
        OR parent_country <> NEW.country_code THEN
        RAISE EXCEPTION 'Area parent must have a current active version in the same country'
          USING ERRCODE = '23514';
      END IF;

      WITH RECURSIVE lineage(area_key, path) AS (
        SELECT NEW.parent_area_key, ARRAY[NEW.area_key]::text[]
        UNION ALL
        SELECT current_parent.parent_area_key, lineage.path || lineage.area_key
        FROM lineage
        JOIN LATERAL (
          SELECT versioned.parent_area_key
          FROM areas.area_node_versions AS versioned
          WHERE versioned.area_key = lineage.area_key
          ORDER BY versioned.version DESC
          LIMIT 1
        ) AS current_parent ON true
        WHERE lineage.area_key IS NOT NULL
          AND NOT lineage.area_key = ANY(lineage.path)
      )
      SELECT EXISTS (
        SELECT 1 FROM lineage WHERE area_key = NEW.area_key
      ) INTO reaches_self;

      IF reaches_self THEN
        RAISE EXCEPTION 'Area hierarchy cycle is not allowed' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE CONSTRAINT TRIGGER reject_current_area_hierarchy_cycle
      AFTER INSERT ON areas.area_node_versions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION areas.reject_current_hierarchy_cycle();

    CREATE TABLE taxonomy.provider_category_mapping_versions (
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,62}$'),
      provider_category_key text NOT NULL
        CHECK (length(provider_category_key) BETWEEN 1 AND 512),
      version integer NOT NULL CHECK (version > 0),
      raw_label text NOT NULL CHECK (length(raw_label) BETWEEN 1 AND 512),
      active boolean NOT NULL,
      decided_by_kind text NOT NULL CHECK (
        decided_by_kind IN ('policy', 'reviewer')
      ),
      decided_by_reference text NOT NULL
        CHECK (length(decided_by_reference) BETWEEN 1 AND 512),
      effective_at timestamptz NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      PRIMARY KEY (provider_key, provider_category_key, version)
    );

    COMMENT ON TABLE taxonomy.provider_category_mapping_versions IS
      'Append-only reviewed mappings from one opaque Provider category identity; raw labels remain evidence and never become Taxonomy keys.';

    CREATE INDEX provider_category_mapping_versions_current
      ON taxonomy.provider_category_mapping_versions (
        provider_key, provider_category_key, version DESC
      );

    CREATE TABLE taxonomy.provider_category_mapping_targets (
      provider_key text NOT NULL,
      provider_category_key text NOT NULL,
      mapping_version integer NOT NULL,
      node_key text NOT NULL,
      node_version integer NOT NULL,
      assignment_role text NOT NULL CHECK (
        assignment_role IN ('primary', 'secondary', 'attribute')
      ),
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
      PRIMARY KEY (
        provider_key, provider_category_key, mapping_version,
        node_key, node_version
      ),
      FOREIGN KEY (provider_key, provider_category_key, mapping_version)
        REFERENCES taxonomy.provider_category_mapping_versions (
          provider_key, provider_category_key, version
        ),
      FOREIGN KEY (node_key, node_version)
        REFERENCES taxonomy.node_versions (node_key, version)
    );

    CREATE UNIQUE INDEX provider_category_mapping_one_primary
      ON taxonomy.provider_category_mapping_targets (
        provider_key, provider_category_key, mapping_version
      ) WHERE assignment_role = 'primary';
    CREATE UNIQUE INDEX provider_category_mapping_target_order
      ON taxonomy.provider_category_mapping_targets (
        provider_key, provider_category_key, mapping_version, ordinal
      );
    CREATE INDEX provider_category_mapping_targets_taxonomy
      ON taxonomy.provider_category_mapping_targets (
        node_key, node_version, provider_key, provider_category_key
      );

    CREATE FUNCTION taxonomy.validate_mapping_target_kind()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      target_kind text;
    BEGIN
      SELECT kind INTO target_kind
      FROM taxonomy.node_versions
      WHERE node_key = NEW.node_key AND version = NEW.node_version;

      IF target_kind IS NULL OR (
        NEW.assignment_role = 'attribute' AND target_kind <> 'attribute'
      ) OR (
        NEW.assignment_role IN ('primary', 'secondary') AND target_kind <> 'category'
      ) THEN
        RAISE EXCEPTION 'Taxonomy mapping role does not match target Node kind'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER validate_provider_category_mapping_target_kind
      BEFORE INSERT ON taxonomy.provider_category_mapping_targets
      FOR EACH ROW
      EXECUTE FUNCTION taxonomy.validate_mapping_target_kind();

    CREATE TABLE places.canonical_place_profile_taxonomy (
      canonical_place_id uuid NOT NULL,
      profile_revision bigint NOT NULL,
      node_key text NOT NULL,
      node_version integer NOT NULL,
      assignment_role text NOT NULL CHECK (
        assignment_role IN ('primary', 'secondary', 'attribute')
      ),
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
      source_assertion_id uuid NOT NULL,
      source_fact_kind text NOT NULL DEFAULT 'taxonomy'
        CHECK (source_fact_kind = 'taxonomy'),
      mapping_provider_key text,
      mapping_provider_category_key text,
      mapping_version integer,
      PRIMARY KEY (
        canonical_place_id, profile_revision, node_key, node_version
      ),
      FOREIGN KEY (canonical_place_id, profile_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        ),
      FOREIGN KEY (node_key, node_version)
        REFERENCES taxonomy.node_versions (node_key, version),
      FOREIGN KEY (source_assertion_id, source_fact_kind)
        REFERENCES places.canonical_place_fact_assertions (id, fact_kind),
      FOREIGN KEY (
        mapping_provider_key, mapping_provider_category_key, mapping_version
      ) REFERENCES taxonomy.provider_category_mapping_versions (
        provider_key, provider_category_key, version
      ),
      FOREIGN KEY (
        mapping_provider_key, mapping_provider_category_key, mapping_version,
        node_key, node_version
      ) REFERENCES taxonomy.provider_category_mapping_targets (
        provider_key, provider_category_key, mapping_version,
        node_key, node_version
      ),
      CHECK (
        (mapping_provider_key IS NULL
          AND mapping_provider_category_key IS NULL
          AND mapping_version IS NULL)
        OR (mapping_provider_key IS NOT NULL
          AND mapping_provider_category_key IS NOT NULL
          AND mapping_version IS NOT NULL)
      )
    );

    COMMENT ON TABLE places.canonical_place_profile_taxonomy IS
      'Immutable exact-version Taxonomy assignments for one Canonical Place profile revision; Provider category mappings remain separately reviewable.';

    CREATE UNIQUE INDEX canonical_place_profile_taxonomy_one_primary
      ON places.canonical_place_profile_taxonomy (
        canonical_place_id, profile_revision
      ) WHERE assignment_role = 'primary';
    CREATE UNIQUE INDEX canonical_place_profile_taxonomy_order
      ON places.canonical_place_profile_taxonomy (
        canonical_place_id, profile_revision, ordinal
      );
    CREATE INDEX canonical_place_profile_taxonomy_node
      ON places.canonical_place_profile_taxonomy (
        node_key, node_version, canonical_place_id, profile_revision
      );

    CREATE TRIGGER validate_canonical_place_profile_taxonomy_kind
      BEFORE INSERT ON places.canonical_place_profile_taxonomy
      FOR EACH ROW
      EXECUTE FUNCTION taxonomy.validate_mapping_target_kind();

    CREATE FUNCTION places.validate_profile_taxonomy_source_assertion()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM places.canonical_place_fact_assertions AS assertion
        JOIN places.canonical_place_fact_assertion_batches AS batch
          ON batch.id = assertion.batch_id
        JOIN places.canonical_place_profile_revisions AS profile
          ON profile.canonical_place_id = NEW.canonical_place_id
         AND profile.revision = NEW.profile_revision
        WHERE assertion.id = NEW.source_assertion_id
          AND assertion.fact_kind = 'taxonomy'
          AND assertion.taxonomy_value = jsonb_build_object(
            'key', NEW.node_key,
            'version', NEW.node_version,
            'role', NEW.assignment_role
          )
          AND (
            (batch.subject_kind = 'canonical-place'
              AND batch.canonical_place_id = NEW.canonical_place_id)
            OR (batch.subject_kind = 'provider-identity' AND EXISTS (
              SELECT 1
              FROM places.provider_place_identities AS identity
              WHERE identity.provider_key = batch.provider_key
                AND identity.external_place_id = batch.external_place_id
                AND identity.canonical_place_id = NEW.canonical_place_id
            ))
          )
      ) THEN
        RAISE EXCEPTION 'profile Taxonomy assignment must match eligible assertion value'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER validate_profile_taxonomy_source_assertion
      BEFORE INSERT ON places.canonical_place_profile_taxonomy
      FOR EACH ROW
      EXECUTE FUNCTION places.validate_profile_taxonomy_source_assertion();

    CREATE TRIGGER reject_published_profile_taxonomy_insert
      BEFORE INSERT ON places.canonical_place_profile_taxonomy
      FOR EACH ROW
      EXECUTE FUNCTION places.reject_published_profile_component_insert();

    CREATE TABLE places.canonical_place_profile_areas (
      canonical_place_id uuid NOT NULL,
      profile_revision bigint NOT NULL,
      area_key text NOT NULL,
      area_version integer NOT NULL,
      assignment_role text NOT NULL CHECK (
        assignment_role IN ('primary', 'ancestor', 'alternate')
      ),
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
      source_assertion_id uuid NOT NULL,
      source_fact_kind text NOT NULL DEFAULT 'area'
        CHECK (source_fact_kind = 'area'),
      PRIMARY KEY (
        canonical_place_id, profile_revision, area_key, area_version
      ),
      FOREIGN KEY (canonical_place_id, profile_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        ),
      FOREIGN KEY (area_key, area_version)
        REFERENCES areas.area_node_versions (area_key, version),
      FOREIGN KEY (source_assertion_id, source_fact_kind)
        REFERENCES places.canonical_place_fact_assertions (id, fact_kind)
    );

    COMMENT ON TABLE places.canonical_place_profile_areas IS
      'Immutable exact-version Area assignments for one Canonical Place profile revision; localized labels are resolved from the Area catalog.';

    CREATE UNIQUE INDEX canonical_place_profile_areas_one_primary
      ON places.canonical_place_profile_areas (
        canonical_place_id, profile_revision
      ) WHERE assignment_role = 'primary';
    CREATE UNIQUE INDEX canonical_place_profile_areas_order
      ON places.canonical_place_profile_areas (
        canonical_place_id, profile_revision, ordinal
      );
    CREATE INDEX canonical_place_profile_areas_area
      ON places.canonical_place_profile_areas (
        area_key, area_version, canonical_place_id, profile_revision
      );

    CREATE FUNCTION places.validate_profile_area_source_assertion()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM places.canonical_place_fact_assertions AS assertion
        JOIN places.canonical_place_fact_assertion_batches AS batch
          ON batch.id = assertion.batch_id
        JOIN places.canonical_place_profile_revisions AS profile
          ON profile.canonical_place_id = NEW.canonical_place_id
         AND profile.revision = NEW.profile_revision
        WHERE assertion.id = NEW.source_assertion_id
          AND assertion.fact_kind = 'area'
          AND assertion.area_value = jsonb_build_object(
            'key', NEW.area_key,
            'version', NEW.area_version,
            'role', NEW.assignment_role
          )
          AND (
            (batch.subject_kind = 'canonical-place'
              AND batch.canonical_place_id = NEW.canonical_place_id)
            OR (batch.subject_kind = 'provider-identity' AND EXISTS (
              SELECT 1
              FROM places.provider_place_identities AS identity
              WHERE identity.provider_key = batch.provider_key
                AND identity.external_place_id = batch.external_place_id
                AND identity.canonical_place_id = NEW.canonical_place_id
            ))
          )
      ) THEN
        RAISE EXCEPTION 'profile Area assignment must match eligible assertion value'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER validate_profile_area_source_assertion
      BEFORE INSERT ON places.canonical_place_profile_areas
      FOR EACH ROW
      EXECUTE FUNCTION places.validate_profile_area_source_assertion();

    CREATE TRIGGER reject_published_profile_area_insert
      BEFORE INSERT ON places.canonical_place_profile_areas
      FOR EACH ROW
      EXECUTE FUNCTION places.reject_published_profile_component_insert();

    GRANT USAGE ON SCHEMA areas TO place_app;
    GRANT SELECT, INSERT ON TABLE
      areas.area_identities,
      areas.area_node_versions,
      taxonomy.provider_category_mapping_versions,
      taxonomy.provider_category_mapping_targets,
      places.canonical_place_profile_taxonomy,
      places.canonical_place_profile_areas
    TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM places.canonical_place_profile_taxonomy)
        OR EXISTS (SELECT 1 FROM places.canonical_place_profile_areas)
        OR EXISTS (SELECT 1 FROM taxonomy.provider_category_mapping_targets)
        OR EXISTS (SELECT 1 FROM taxonomy.provider_category_mapping_versions)
        OR EXISTS (SELECT 1 FROM areas.area_node_versions)
        OR EXISTS (SELECT 1 FROM areas.area_identities) THEN
        RAISE EXCEPTION 'cannot remove Area and Taxonomy foundations while version or assignment history exists';
      END IF;
    END $$;

    DROP TRIGGER validate_profile_area_source_assertion
      ON places.canonical_place_profile_areas;
    DROP TRIGGER reject_published_profile_area_insert
      ON places.canonical_place_profile_areas;
    DROP FUNCTION places.validate_profile_area_source_assertion();
    DROP TABLE places.canonical_place_profile_areas;
    DROP TRIGGER validate_profile_taxonomy_source_assertion
      ON places.canonical_place_profile_taxonomy;
    DROP TRIGGER reject_published_profile_taxonomy_insert
      ON places.canonical_place_profile_taxonomy;
    DROP FUNCTION places.validate_profile_taxonomy_source_assertion();
    DROP TRIGGER validate_canonical_place_profile_taxonomy_kind
      ON places.canonical_place_profile_taxonomy;
    DROP TABLE places.canonical_place_profile_taxonomy;
    DROP TRIGGER validate_provider_category_mapping_target_kind
      ON taxonomy.provider_category_mapping_targets;
    DROP FUNCTION taxonomy.validate_mapping_target_kind();
    DROP TABLE taxonomy.provider_category_mapping_targets;
    DROP TABLE taxonomy.provider_category_mapping_versions;
    DROP TRIGGER reject_current_area_hierarchy_cycle
      ON areas.area_node_versions;
    DROP FUNCTION areas.reject_current_hierarchy_cycle();
    DROP TABLE areas.area_node_versions;
    DROP TABLE areas.area_identities;
    DROP FUNCTION areas.localized_names_are_valid(jsonb);
    DROP SCHEMA areas;
  `)
}
